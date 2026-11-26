"""Standalone MCP server for the independent universality demo module."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import anyio
from jsonschema.validators import validator_for
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, ListToolsResult, TextContent, Tool

MODULE_ID = "org.example.independent-decorator"
PUBLISHER = "org.example"
VERSION = "1.0.0"
MMP_VERSION = "0.1.0"
CONTRACT_ID = "urn:mmp:universal:document:1.0.0"
CAPABILITY = "org.example/universal.decorate"
TOOL_NAME = "decorate"
EXTENSION = "io.github.artemnoor/mmp"
CONTRIBUTION = "Independent Python contribution"


def _load_contract() -> dict[str, Any]:
    """Load the externally owned schema without copying it into this package."""
    contract_path = os.environ.get("MMP_DEMO_CONTRACT")
    if not contract_path:
        raise RuntimeError("MMP_DEMO_CONTRACT must point to the shared contract JSON")

    path = Path(contract_path).expanduser()
    try:
        contract_document = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RuntimeError(f"Cannot read MMP demo contract at {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"MMP demo contract at {path} is not valid JSON: {exc}") from exc

    # Contract files may be a schema directly or an envelope such as
    # {"id": "...", "schema": {...}}. Keep the source schema intact.
    schema = contract_document.get("schema") if isinstance(contract_document, dict) else None
    if schema is None:
        schema = contract_document
    if not isinstance(schema, dict):
        raise TypeError("MMP demo contract must contain a JSON Schema object")

    validator_type = validator_for(schema)
    validator_type.check_schema(schema)
    return schema


def _descriptor() -> dict[str, Any]:
    return {
        "id": MODULE_ID,
        "publisher": PUBLISHER,
        "version": VERSION,
        "mmpVersion": MMP_VERSION,
        "description": "Independent Python decorator for the shared document contract.",
        "requires": [],
        "operations": [
            {
                "capability": CAPABILITY,
                "inputContract": CONTRACT_ID,
                "outputContract": CONTRACT_ID,
                "tool": TOOL_NAME,
                "permissions": [],
                "effects": "read-only",
                "execution": "sync",
                "idempotency": {"mode": "natural"},
            }
        ],
    }


def _text_result(value: dict[str, Any]) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(value, ensure_ascii=False))],
        structured_content=value,
    )


def _contract_error(message: str) -> CallToolResult:
    return CallToolResult(
        is_error=True,
        content=[TextContent(type="text", text=message)],
    )


async def _run() -> None:
    schema = _load_contract()
    validator_type = validator_for(schema)
    validator = validator_type(schema)
    descriptor = _descriptor()
    tool = Tool(
        name=TOOL_NAME,
        description="Append the independent Python contribution to a shared document.",
        input_schema=schema,
        output_schema=schema,
    )

    async def list_tools(_ctx: Any, _params: Any) -> ListToolsResult:
        return ListToolsResult(tools=[tool])

    async def call_tool(_ctx: Any, params: Any) -> CallToolResult:
        if params.name != TOOL_NAME:
            return _contract_error("Unknown tool")

        arguments = params.arguments or {}
        if not isinstance(arguments, dict) or not validator.is_valid(arguments):
            return _contract_error("Input does not satisfy the shared document contract")

        result = dict(arguments)
        result["notes"] = [*arguments["notes"], CONTRIBUTION]
        if not validator.is_valid(result):
            return _contract_error("Decorated output does not satisfy the shared document contract")
        return _text_result(result)

    server = Server(
        MODULE_ID,
        version=VERSION,
        on_list_tools=list_tools,
        on_call_tool=call_tool,
    )
    server.extensions = {EXTENSION: {"descriptor": descriptor}}
    options = server.create_initialization_options()
    async with stdio_server() as (reader, writer):
        await server.run(reader, writer, options)


def main() -> None:
    anyio.run(_run)


if __name__ == "__main__":
    main()
