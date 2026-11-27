"""Stdio MMP fixture provider used by the Python Host integration tests.

Roles:
  echo   -- exports test.echo/echo and calls no dependencies.
  caller -- exports test.caller/relay and calls test.echo/echo through the Gateway.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx2
import mcp.types as types
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server

EXT = "io.github.artemnoor/mmp"
CTX_META = "io.github.artemnoor/mmp-context"
ERR_META = "io.github.artemnoor/mmp-error"
GRANT_META = "io.github.artemnoor/mmp-grant"
CONTRACT_ID = "urn:mmp:test:message:1.0.0"
FIXTURE_ROOT = Path(__file__).parent
SCHEMA = json.loads((FIXTURE_ROOT / "contract.json").read_text(encoding="utf-8"))["schema"]
COUNTER = 0


def error_result(kind: str, message: str, *, retryable: bool = False,
                 outcome: str = "failed", correlation_id: str = "downstream-correlation") -> types.CallToolResult:
    return types.CallToolResult.model_validate({
        "isError": True,
        "content": [{"type": "text", "text": message}],
        "_meta": {ERR_META: {"kind": kind, "message": message, "retryable": retryable,
                             "outcome": outcome, "correlationId": correlation_id}},
    })


def success(value: dict[str, Any]) -> types.CallToolResult:
    return types.CallToolResult.model_validate({
        "content": [{"type": "text", "text": json.dumps(value)}],
        "structuredContent": value,
    })


def operation(capability: str, tool: str, idempotency: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "capability": capability,
        "inputContract": CONTRACT_ID,
        "outputContract": CONTRACT_ID,
        "tool": tool,
        "permissions": [],
        "effects": "read-only",
        "execution": "sync",
        "idempotency": idempotency or {"mode": "none"},
    }


async def echo_call(arguments: dict[str, Any]) -> types.CallToolResult:
    message = arguments.get("message")
    if not isinstance(message, str):
        return error_result("CONTRACT_MISMATCH", "message must be a string", outcome="not-started")
    if message == "MMP_FAIL":
        return error_result("PERMISSION_DENIED", "downstream denied by policy", outcome="not-started")
    if message == "MMP_BOOM":
        raise RuntimeError("fixture exploded")
    if message == "MMP_BAD":
        return success({"wrong": message})
    if message == "MMP_SLOW":
        await asyncio.sleep(30)
    return success({"message": message})


def build_server(role: str, gateway: Client | None = None, version: str = "1.0.0") -> Server:
    if role == "echo":
        module_id, capability, tool = "test.echo", "test.echo/echo", "echo"
        operations = [operation(capability, tool)]
        requires: list[dict[str, str]] = []
    elif role == "caller":
        module_id, capability, tool = "test.caller", "test.caller/relay", "relay"
        operations = [operation(capability, tool)]
        requires = [{"capability": "test.echo/echo", "inputContract": CONTRACT_ID,
                     "outputContract": CONTRACT_ID}]
        if gateway is None:
            raise ValueError("caller role requires a Gateway client")
    elif role in ("dedup", "dedup_none"):
        module_id = "test.dedup"
        count_idempotency = ({"mode": "deduplicated", "retentionSeconds": 60, "restartPersistent": False}
                             if role == "dedup" else {"mode": "none"})
        operations = [
            operation("test.dedup/count", "count", count_idempotency),
            operation("test.dedup/stats", "stats"),
        ]
        requires = []
    else:
        raise SystemExit(f"unknown role: {role}")

    descriptor = {
        "id": module_id,
        "version": version,
        "mmpVersion": "0.1.0",
        "publisher": "test",
        "description": f"Python Host fixture {role} provider",
        "requires": requires,
        "operations": operations,
    }

    async def on_list_tools(ctx, params):
        return types.ListToolsResult(tools=[
            types.Tool(name=op["tool"], description=op["capability"],
                       inputSchema=SCHEMA, outputSchema=SCHEMA)
            for op in operations
        ])

    async def relay(arguments: dict[str, Any], meta: Any) -> types.CallToolResult:
        token = meta.get(CTX_META) if isinstance(meta, dict) else None
        if not isinstance(token, str):
            return error_result("PERMISSION_DENIED", "missing invocation context", outcome="not-started")
        if meta.get(GRANT_META) != os.environ.get("MMP_HOST_GRANT"):
            return error_result("PERMISSION_DENIED", "missing Host grant", outcome="not-started")
        if arguments.get("message") == "MMP_DELAY":
            await asyncio.sleep(1.0)
        assert gateway is not None
        result = await gateway.call_tool("mmp_invoke", {
            "capability": "test.echo/echo",
            "inputContract": CONTRACT_ID,
            "outputContract": CONTRACT_ID,
            "arguments": arguments,
        }, meta={CTX_META: token})
        if result.is_error:
            data = result.meta.get(ERR_META) if isinstance(result.meta, dict) else None
            if isinstance(data, dict):
                return error_result(data["kind"], data["message"], retryable=data["retryable"],
                                    outcome=data["outcome"], correlation_id=data["correlationId"])
            return error_result("INTERNAL", "nested call failed", outcome="unknown")
        structured = result.structured_content
        if not isinstance(structured, dict) or not isinstance(structured.get("result"), dict):
            return error_result("CONTRACT_MISMATCH", "nested call returned no result", outcome="failed")
        return success(structured["result"])

    async def on_call_tool(ctx, params):
        global COUNTER
        arguments = params.arguments if isinstance(params.arguments, dict) else {}
        if role == "echo":
            return await echo_call(arguments)
        if role in ("dedup", "dedup_none"):
            if params.name == "stats":
                return success({"message": str(COUNTER)})
            COUNTER += 1
            return success({"message": f"{arguments.get('message')}:{COUNTER}"})
        if params.name == "relay":
            return await relay(arguments, ctx.meta)
        return error_result("DEPENDENCY_UNAVAILABLE", "unknown tool", outcome="not-started")

    server = Server(f"fixture-{role}", version="1.0.0", on_list_tools=on_list_tools,
                    on_call_tool=on_call_tool)
    server.extensions[EXT] = {"descriptor": descriptor}
    return server


async def run_server(server: Server) -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


async def main() -> None:
    role = sys.argv[1] if len(sys.argv) > 1 else "echo"
    version = sys.argv[2] if len(sys.argv) > 2 else "1.0.0"
    if role != "caller":
        await run_server(build_server(role, version=version))
        return
    http_client = httpx2.AsyncClient(headers={"Authorization": f"Bearer {os.environ['MMP_CREDENTIAL']}"})
    transport = streamable_http_client(os.environ["MMP_GATEWAY"], http_client=http_client)
    client = Client(transport)
    async with http_client, client:
        await run_server(build_server(role, client, version=version))


if __name__ == "__main__":
    asyncio.run(main())
