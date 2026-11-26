import json
from pathlib import Path

import anyio
from jsonschema import Draft202012Validator
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, ListToolsResult, TextContent, Tool

schema = json.loads(Path(__file__).with_name("contract.json").read_text(encoding="utf-8"))["schema"]
contract = schema["$id"]
validator = Draft202012Validator(schema)
tool = Tool(name="echo", input_schema=schema, output_schema=schema)
MODULE_ID = "org.example.python-echo"
descriptor = {
    "id": MODULE_ID,
    "publisher": "org.example",
    "version": "1.0.0",
    "mmpVersion": "0.1.0",
    "description": "Return a message unchanged",
    "requires": [],
    "operations": [{
        "capability": "org.example/echo",
        "inputContract": contract,
        "outputContract": contract,
        "tool": "echo",
        "effects": "read-only",
        "permissions": [],
        "execution": "sync",
        "idempotency": {"mode": "natural"},
    }],
}


async def list_tools(_ctx, _params):
    return ListToolsResult(tools=[tool])


async def call_tool(_ctx, params):
    value = params.arguments or {}
    if params.name != "echo" or not validator.is_valid(value):
        return CallToolResult(
            is_error=True,
            content=[TextContent(type="text", text="Expected a valid echo request")],
            _meta={"io.github.artemnoor/mmp-error": {
                "kind": "CONTRACT_MISMATCH", "message": "Expected a valid echo request",
                "outcome": "not-started", "retryable": False, "correlationId": "local",
            }},
        )
    return CallToolResult(
        structured_content=value,
        content=[TextContent(type="text", text=json.dumps(value))],
    )


async def main():
    server = Server(MODULE_ID, version="1.0.0", on_list_tools=list_tools, on_call_tool=call_tool)
    server.extensions = {"io.github.artemnoor/mmp": {"descriptor": descriptor}}
    async with stdio_server() as (reader, writer):
        await server.run(reader, writer, server.create_initialization_options())


if __name__ == "__main__":
    anyio.run(main)
