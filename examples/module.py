import json
import os
import sys
from pathlib import Path
from typing import cast

import anyio
import httpx2
from jsonschema import Draft202012Validator
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    CallToolResult,
    ListToolsResult,
    RequestParamsMeta,
    TextContent,
    Tool,
)

ROOT = Path(__file__).resolve().parents[1]
ROLE = sys.argv[1]
EXTENSION = "org.example/mmp"
CONTEXT = "org.example/mmp-context"
ERROR = "org.example/mmp-error"


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def schema(contract):
    return read(f"contracts/{contract.split(':')[3]}.json")["schema"]


descriptor = read(f"examples/descriptors/{ROLE}.json")
definitions = {
    op["tool"]: Tool(
        name=op["tool"],
        input_schema=schema(op["inputContract"]),
        output_schema=schema(op["outputContract"]),
    )
    for op in descriptor["operations"]
}


def output(value):
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(value))], structured_content=value
    )


def reject(kind):
    return CallToolResult(
        is_error=True, content=[TextContent(type="text", text=kind)],
        _meta={ERROR: {
            "kind": kind, "message": kind, "outcome": "not-started",
            "retryable": False, "correlationId": "unavailable",
        }},
    )


async def list_tools(_ctx, _params):
    return ListToolsResult(tools=list(definitions.values()))


async def call_tool(ctx, params):
    tool = definitions.get(params.name)
    args = params.arguments or {}
    if tool is None or not Draft202012Validator(tool.input_schema).is_valid(args):
        return reject("CONTRACT_MISMATCH")
    if ROLE == "python":
        await anyio.sleep(args.get("waitMs", 0) / 1000)
        return output({"findings": [f"{params.name} via python: {args['topic']}"]})

    token = (ctx.meta or {}).get(CONTEXT)
    credential = os.environ.get("MMP_CREDENTIAL")
    gateway = os.environ.get("MMP_GATEWAY")
    if not isinstance(token, str) or not credential or not gateway:
        return reject("PERMISSION_DENIED")
    metadata = cast(RequestParamsMeta, {CONTEXT: token})
    async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {credential}"}, timeout=10.0) as http:
        transport = streamable_http_client(gateway, http_client=http)
        async with Client(transport, mode="2026-07-28") as client:
            result = await client.call_tool("mmp_invoke", {
                "capability": "org.example/review",
                "inputContract": "urn:mmp:example:plan:1.0.0",
                "outputContract": "urn:mmp:example:report:1.0.0",
                "arguments": args,
            }, meta=metadata)
    return result if result.is_error else output(result.structured_content["result"])


async def main():
    server = Server(descriptor["id"], version=descriptor["version"], on_list_tools=list_tools, on_call_tool=call_tool)
    server.extensions = {EXTENSION: {"descriptor": descriptor}}
    options = server.create_initialization_options()
    async with stdio_server() as (reader, writer):
        await server.run(reader, writer, options)


if __name__ == "__main__":
    anyio.run(main)
