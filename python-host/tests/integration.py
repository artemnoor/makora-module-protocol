"""Integration checks for the Python MMP Host.

Run from python-host with the locked environment:
    uv run --locked python tests\\integration.py
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from mmp_host import Host, MMPError, Provider

ROOT = Path(__file__).parent / "fixtures"
CONTRACT = ROOT / "contract.json"
PROVIDER = ROOT / "provider.py"
CONTRACT_ID = "urn:mmp:test:message:1.0.0"
ECHO = {"capability": "test.echo/echo", "inputContract": CONTRACT_ID, "outputContract": CONTRACT_ID}
RELAY = {"capability": "test.caller/relay", "inputContract": CONTRACT_ID, "outputContract": CONTRACT_ID}
CTX_META = "io.github.artemnoor/mmp-context"
ERR_META = "io.github.artemnoor/mmp-error"
PASSED = 0
FAILED: list[str] = []


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"PASS {name}")
    else:
        FAILED.append(name)
        print(f"FAIL {name} {detail}")


async def expect_error(name: str, awaitable, kind: str, outcome: str) -> MMPError | None:
    try:
        await awaitable
    except MMPError as error:
        check(name, error.kind == kind and error.outcome == outcome,
              f"got {error.kind}/{error.outcome}: {error.message}")
        check(f"{name} correlation", bool(error.correlation_id))
        return error
    check(name, False, "no MMPError raised")
    return None


async def raw_response(port: int, headers: dict[str, str],
                       body: dict[str, Any]) -> tuple[int, list[str]]:
    """Send a literal HTTP/1.1 request.

    httpx and similar clients normalize the Host header to the URL authority,
    so authority-guard checks must use a raw socket.
    """
    payload = json.dumps(body).encode()
    lines = ["POST /mcp HTTP/1.1"]
    for key, value in headers.items():
        lines.append(f"{key}: {value}")
    lines.append("Content-Type: application/json")
    lines.append("Accept: application/json, text/event-stream")
    lines.append(f"Content-Length: {len(payload)}")
    lines.append("Connection: close")
    request = ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + payload

    async def exchange() -> tuple[int, list[str]]:
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        try:
            writer.write(request)
            await writer.drain()
            status_line = (await reader.readline()).decode("latin-1").strip()
            response_headers: list[str] = []
            while True:
                line = await reader.readline()
                if line in (b"\r\n", b"\n", b""):
                    break
                response_headers.append(line.decode("latin-1").strip())
            await reader.read()
            return int(status_line.split()[1]), response_headers
        finally:
            writer.close()
            await writer.wait_closed()

    return await asyncio.wait_for(exchange(), timeout=10)


async def raw_post(port: int, headers: dict[str, str], body: dict[str, Any]) -> int:
    status, _ = await raw_response(port, headers, body)
    return status


async def gateway_client(host: Host) -> tuple[httpx2.AsyncClient, Client]:
    http_client = httpx2.AsyncClient(
        headers={"Authorization": f"Bearer {host.credentials['test.echo']}", "Accept": "application/json, text/event-stream"})
    return http_client, Client(streamable_http_client(host.gateway, http_client=http_client))


async def expect_value_error(name: str, awaitable) -> None:
    try:
        result = await awaitable
    except ValueError:
        check(name, True)
        return
    if hasattr(result, "close"):
        await result.close()
    check(name, False, "no ValueError raised")


async def main() -> None:
    echo_config = {"id": "test.echo", "publisher": "test", "version": "1.0.0", "root": str(ROOT),
                   "command": sys.executable, "args": ["provider.py", "echo"],
                   "files": {"contract.json": digest(CONTRACT), "provider.py": digest(PROVIDER)}}
    host = await Host.start({
        "contracts": [{"id": CONTRACT_ID, "file": str(CONTRACT), "sha256": digest(CONTRACT)}],
        "providers": [
            echo_config,
            {"id": "test.caller", "publisher": "test", "version": "1.0.0", "root": str(ROOT),
             "command": sys.executable, "args": ["provider.py", "caller"],
             "files": {"contract.json": digest(CONTRACT), "provider.py": digest(PROVIDER)}},
            {"id": "test.dedup", "publisher": "test", "version": "1.0.0", "root": str(ROOT),
             "command": sys.executable, "args": ["provider.py", "dedup"],
             "files": {"contract.json": digest(CONTRACT), "provider.py": digest(PROVIDER)}},
        ],
        "knownPermissions": [],
        "maxDedupEntries": 1,
        "grants": [
            {"caller": "host:app", "target": "test.echo", "tool": "echo",
             "effects": "read-only", "permissions": []},
            {"caller": "host:app", "target": "test.caller", "tool": "relay",
             "effects": "read-only", "permissions": []},
            {"caller": "host:app", "target": "test.dedup", "tool": "count",
             "effects": "read-only", "permissions": []},
            {"caller": "host:app", "target": "test.dedup", "tool": "stats",
             "effects": "read-only", "permissions": []},
            {"caller": "test.caller", "target": "test.echo", "tool": "echo",
             "effects": "read-only", "permissions": []},
        ],
    })
    try:
        result = await host.invoke("host:app", {**ECHO, "arguments": {"message": "Hello"}})
        check("root success", result == {"outputContract": CONTRACT_ID, "result": {"message": "Hello"}})

        parallel = await asyncio.gather(*(host.invoke("host:app", {
            **ECHO, "arguments": {"message": f"p{index}"}}) for index in range(8)))
        check("parallel root", all(item["result"]["message"] == f"p{index}"
                                   for index, item in enumerate(parallel)))

        nested = await host.invoke("host:app", {**RELAY, "arguments": {"message": "Nested"}})
        check("nested two stdio providers", nested["result"] == {"message": "Nested"})

        await expect_error("nested typed failure",
                           host.invoke("host:app", {**RELAY, "arguments": {"message": "MMP_FAIL"}}),
                           "PERMISSION_DENIED", "not-started")
        await expect_error("nested protocol failure",
                           host.invoke("host:app", {**RELAY, "arguments": {"message": "MMP_BOOM"}}),
                           "INTERNAL", "unknown")
        await expect_error("direct typed failure",
                           host.invoke("host:app", {**ECHO, "arguments": {"message": "MMP_FAIL"}}),
                           "PERMISSION_DENIED", "not-started")
        await expect_error("invalid capability",
                           host.invoke("host:app", {**ECHO, "capability": "Bad",
                                                    "arguments": {"message": "x"}}),
                           "CONTRACT_MISMATCH", "not-started")
        await expect_error("expired deadline zero",
                           host.invoke("host:app", {**ECHO, "arguments": {"message": "MMP_SLOW"}},
                                        deadline_ms=0),
                           "DEADLINE_EXCEEDED", "not-started")
        check("deadline zero left no context", not host.contexts)

        deadline = int(time.time() * 1000) + 300
        await expect_error("budget deadline",
                           host.invoke("host:app", {**ECHO, "arguments": {"message": "MMP_SLOW"}},
                                        deadline_ms=deadline),
                           "DEADLINE_EXCEEDED", "unknown")
        await asyncio.sleep(0)
        check("deadline left no context", not host.contexts)

        cancellation = asyncio.create_task(
            host.invoke("host:app", {**ECHO, "arguments": {"message": "MMP_SLOW"}}))
        await asyncio.sleep(0.2)
        cancellation.cancel()
        await expect_error("cancellation", cancellation, "CANCELLED", "unknown")
        await asyncio.sleep(0)
        check("cancellation left no context", not host.contexts)

        delayed = asyncio.create_task(
            host.invoke("host:app", {**RELAY, "arguments": {"message": "MMP_DELAY"}}))
        await asyncio.sleep(0.2)
        await host.remove_provider("test.echo")
        await host.add_provider(Provider(
            id="test.echo", publisher="test", version="1.0.0", command=sys.executable,
            root=str(ROOT), args=("provider.py", "echo"),
            files={"contract.json": digest(CONTRACT), "provider.py": digest(PROVIDER)}))
        await expect_error("provider generation change rejected", delayed,
                           "DEPENDENCY_UNAVAILABLE", "not-started")

        count = {"capability": "test.dedup/count", "inputContract": CONTRACT_ID,
                 "outputContract": CONTRACT_ID}
        stats = {"capability": "test.dedup/stats", "inputContract": CONTRACT_ID,
                 "outputContract": CONTRACT_ID}
        first = await host.invoke("host:app", {**count, "arguments": {"message": "a"},
                                               "idempotencyKey": "one"})
        duplicate = await host.invoke("host:app", {**count, "arguments": {"message": "a"},
                                                   "idempotencyKey": "one"})
        check("dedup replay", first == duplicate == {"outputContract": CONTRACT_ID,
                                                     "result": {"message": "a:1"}})
        check("dedup retained one effect",
              (await host.invoke("host:app", {**stats, "arguments": {"message": "x"}}))["result"]["message"] == "1")
        await expect_error("dedup capacity rejects new key",
                           host.invoke("host:app", {**count, "arguments": {"message": "b"},
                                                    "idempotencyKey": "two"}),
                           "INTERNAL", "not-started")
        check("dedup capacity did not dispatch",
              (await host.invoke("host:app", {**stats, "arguments": {"message": "x"}}))["result"]["message"] == "1")
        check("dedup retained replay after capacity",
              (await host.invoke("host:app", {**count, "arguments": {"message": "a"},
                                              "idempotencyKey": "one"}))["result"]["message"] == "a:1")
        await expect_error("dedup retained conflict",
                           host.invoke("host:app", {**count, "arguments": {"message": "changed"},
                                                    "idempotencyKey": "one"}),
                           "IDEMPOTENCY_CONFLICT", "not-started")

        await host.remove_provider("test.dedup")
        await host.add_provider(Provider(
            id="test.dedup", publisher="test", version="1.0.1", command=sys.executable,
            root=str(ROOT), args=("provider.py", "dedup_none", "1.0.1"),
            files={"contract.json": digest(CONTRACT), "provider.py": digest(PROVIDER)}))
        await expect_error("retained key conflicts on replacement mode",
                           host.invoke("host:app", {**count, "arguments": {"message": "a"},
                                                    "idempotencyKey": "one"}),
                           "IDEMPOTENCY_CONFLICT", "not-started")
        check("replacement natural provider dispatch",
              (await host.invoke("host:app", {**stats, "arguments": {"message": "x"}}))["result"]["message"] == "0")

        port = host.address[1] if host.address else 0
        authority = f"127.0.0.1:{port}"
        origin = f"http://{authority}"
        credential = host.credentials["test.echo"]
        body = {"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": {"_meta": {}}}
        check("foreign origin 403", await raw_post(port, {
            "Host": authority, "Origin": "http://evil.example",
            "Authorization": f"Bearer {credential}"}, body) == 403)
        check("foreign host 403", await raw_post(port, {
            "Host": "evil.example", "Authorization": f"Bearer {credential}"}, body) == 403)
        check("wrong authority port 403", await raw_post(port, {
            "Host": f"127.0.0.1:{port + 1}", "Origin": origin,
            "Authorization": f"Bearer {credential}"}, body) == 403)
        check("missing bearer 401", await raw_post(port, {"Host": authority, "Origin": origin}, body) == 401)
        check("wrong bearer 401", await raw_post(port, {
            "Host": authority, "Origin": origin, "Authorization": "Bearer nope"}, body) == 401)

        client_http, client = await gateway_client(host)
        async with client_http, client:
            listing = await client.list_tools(cache_mode="refresh")
            tool = listing.tools[0]
            check("gateway exposes one tool", [item.name for item in listing.tools] == ["mmp_invoke"])
            check("gateway canonical invoke schema",
                  tool.input_schema.get("required") == ["capability", "inputContract", "outputContract", "arguments"]
                  and tool.input_schema.get("additionalProperties") is False)
            output_schema = tool.output_schema or {}
            check("gateway success output schema",
                  output_schema.get("required") == ["outputContract", "result"]
                  and output_schema.get("additionalProperties") is False)
            denied = await client.call_tool("mmp_invoke", {
                "capability": "test.echo/echo", "inputContract": CONTRACT_ID,
                "outputContract": CONTRACT_ID, "arguments": {"message": "x"}})
            check("missing context typed denial", denied.is_error)
            error_meta = (denied.meta or {}).get(ERR_META, {})
            check("typed denial error schema", error_meta.get("kind") == "PERMISSION_DENIED"
                  and bool(error_meta.get("correlationId")) and error_meta.get("outcome") == "not-started")
            malformed = await client.call_tool("mmp_invoke", {
                "capability": "test.echo/echo", "inputContract": CONTRACT_ID,
                "outputContract": CONTRACT_ID, "arguments": {"message": "x"}},
                meta={CTX_META: []})
            check("malformed context typed denial", malformed.is_error
                  and (malformed.meta or {}).get(ERR_META, {}).get("kind") == "PERMISSION_DENIED")
    finally:
        await host.close()

    def start_with(provider: dict[str, Any]):
        return Host.start({
            "contracts": [{"id": CONTRACT_ID, "file": str(CONTRACT), "sha256": digest(CONTRACT)}],
            "providers": [provider],
            "knownPermissions": [],
            "grants": [{"caller": "host:app", "target": "test.echo", "tool": "echo",
                        "effects": "read-only", "permissions": []}],
        })

    pinned = {"id": "test.echo", "publisher": "test", "version": "1.0.0", "root": str(ROOT),
              "command": sys.executable, "args": ["provider.py", "echo"],
              "files": {"contract.json": digest(CONTRACT), "provider.py": digest(PROVIDER)}}
    await expect_value_error("relative runtime command rejected",
                             start_with({**pinned, "command": "python"}))
    await expect_value_error("unpinned launch entry rejected",
                             start_with({**pinned, "files": {"contract.json": digest(CONTRACT)}}))
    await expect_value_error("absolute launch entry rejected",
                             start_with({**pinned, "args": [str(PROVIDER), "echo"]}))

    print(f"\n{PASSED} checks passed, {len(FAILED)} failed")
    if FAILED:
        print("failed:", ", ".join(FAILED))
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
