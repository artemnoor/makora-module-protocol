import json
import os
import sys
from typing import cast

import anyio
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.server import MCPServer
from mcp.server.extension import Extension
from mcp.server.mcpserver import Context
from mcp.types import CallToolResult, RequestParamsMeta, TextContent
from pydantic import BaseModel


class MmpExtension(Extension):
    identifier = "io.github.artemnoor/mmp"

    def settings(self):
        return {"descriptor": {"id": "python", "mmpVersion": "0.1.0"}}


class Report(BaseModel):
    findings: list[str]


server = MCPServer("python", version="1.0.0", extensions=[MmpExtension()])


@server.tool()
async def report(topic: str, waitMs: int = 0) -> Report:
    try:
        await anyio.sleep(waitMs / 1000)
    except anyio.get_cancelled_exc_class():
        print("mmp-spike: handler cancelled", file=sys.stderr, flush=True)
        raise
    return Report(findings=[f"python:{topic}"])


@server.tool()
async def delegate(topic: str, capability: str, ctx: Context, waitMs: int = 0) -> CallToolResult:
    headers = {"Authorization": f"Bearer {os.environ['MMP_CREDENTIAL']}"}
    async with httpx2.AsyncClient(headers=headers, timeout=5.0) as http:
        transport = streamable_http_client(os.environ["MMP_GATEWAY"], http_client=http)
        async with Client(transport, mode="2026-07-28") as client:
            inbound = ctx.request_context.meta
            value = (inbound or {}).get("io.github.artemnoor/mmp-context")
            metadata = cast(RequestParamsMeta, {"io.github.artemnoor/mmp-context": value})
            result = await client.call_tool(
                "mmp_invoke",
                {
                    "capability": capability,
                    "inputContract": "urn:mmp:example:task:1.0.0",
                    "outputContract": "urn:mmp:example:report:1.0.0",
                    "arguments": {"topic": topic, "waitMs": waitMs},
                },
                meta=metadata,
            )
    if result.is_error:
        return CallToolResult(
            is_error=True,
            content=[TextContent(type="text", text="Gateway invocation failed")],
            _meta=result.meta,
        )
    report = Report.model_validate(result.structured_content["result"]).model_dump()
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(report))],
        structured_content=report,
    )


if __name__ == "__main__":
    server.run(transport="stdio")
