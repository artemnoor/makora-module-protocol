import json
import os
from pathlib import Path

import anyio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, ListToolsResult, TextContent, Tool

descriptor = json.loads(os.environ["MMP_DEMO_DESCRIPTOR"])
contract = json.loads(Path(os.environ["MMP_DEMO_CONTRACT"]).read_text(encoding="utf-8"))["schema"]
tool = Tool(name="metrics", input_schema=contract, output_schema=contract)


async def list_tools(_ctx, _params):
    return ListToolsResult(tools=[tool])


async def call_tool(_ctx, params):
    document = params.arguments or {}
    task = document["task"]
    await anyio.sleep(int(os.environ.get("MMP_DEMO_DELAY", "0")) / 1000)
    note = f"Метрики Python: {len(task.split())} слов, {len(task)} символов"
    result = {**document, "notes": [*document["notes"], note]}
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
        structured_content=result,
    )


async def main():
    server = Server(
        descriptor["id"], version=descriptor["version"],
        on_list_tools=list_tools, on_call_tool=call_tool,
    )
    server.extensions = {"io.github.artemnoor/mmp": {"descriptor": descriptor}}
    async with stdio_server() as (reader, writer):
        await server.run(reader, writer, server.create_initialization_options())


if __name__ == "__main__":
    anyio.run(main)
