"""Read-only MCP stdio provider for the MMP 0.1.0 profile."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server

MODULE_ID = "org.independent.python"
PUBLISHER = "org.independent"
VERSION = "1.0.0"
MMP_VERSION = "0.1.0"
CONTRACT_ID = "urn:mmp:independent:reading:1.0.0"
EXTENSION_ID_DEFAULT = "io.github.artemnoor/mmp"
CLASSIFY = "org.independent/classify"
ANNOTATE = "org.independent/annotate"


def _reject_external_refs(value: Any) -> None:
    """Permit local JSON Schema references only; validation must not fetch URLs."""
    if isinstance(value, dict):
        ref = value.get("$ref")
        if ref is not None and (not isinstance(ref, str) or not ref.startswith("#")):
            raise ValueError("LAB_CONTRACT schema may use only local fragment $ref values")
        for child in value.values():
            _reject_external_refs(child)
    elif isinstance(value, list):
        for child in value:
            _reject_external_refs(child)


def load_contract() -> tuple[dict[str, Any], Draft202012Validator]:
    contract_path = os.environ.get("LAB_CONTRACT")
    if not contract_path:
        raise RuntimeError("LAB_CONTRACT must point to a JSON envelope containing a schema")
    envelope = json.loads(Path(contract_path).read_text(encoding="utf-8"))
    if not isinstance(envelope, dict) or not isinstance(envelope.get("schema"), dict):
        raise TypeError("LAB_CONTRACT must be a JSON object with a schema object property")
    schema = envelope["schema"]
    if schema.get("$id") != CONTRACT_ID or schema.get("type") != "object":
        raise ValueError(f"LAB_CONTRACT must contain the object schema {CONTRACT_ID}")
    _reject_external_refs(schema)
    Draft202012Validator.check_schema(schema)
    return schema, Draft202012Validator(schema)


def failed(kind: str, message: str, outcome: str) -> types.CallToolResult:
    return types.CallToolResult(
        is_error=True,
        content=[types.TextContent(type="text", text=message)],
        _meta={"io.github.artemnoor/mmp-error": {
            "kind": kind, "message": message, "outcome": outcome,
            "retryable": False, "correlationId": "independent-python",
        }},
    )


def build_descriptor() -> dict[str, Any]:
    operations = []
    for capability, tool in ((CLASSIFY, "classify"), (ANNOTATE, "annotate")):
        operations.append(
            {
                "capability": capability,
                "inputContract": CONTRACT_ID,
                "outputContract": CONTRACT_ID,
                "tool": tool,
                "permissions": [],
                "effects": "read-only",
                "execution": "sync",
                "idempotency": {"mode": "natural"},
            }
        )
    return {
        "id": MODULE_ID,
        "version": VERSION,
        "mmpVersion": MMP_VERSION,
        "publisher": PUBLISHER,
        "description": "Read-only classification and annotation for independent reading records.",
        "requires": [],
        "operations": operations,
    }


def build_server() -> Server:
    contract_schema, contract_validator = load_contract()
    extension_id = os.environ.get("MMP_EXTENSION_ID", EXTENSION_ID_DEFAULT)
    descriptor = build_descriptor()

    async def list_tools(_ctx: Any, _params: Any) -> types.ListToolsResult:
        tools = [
            types.Tool(
                name="classify",
                description="Classify a reading record and append the classified note.",
                input_schema=contract_schema,
                output_schema=contract_schema,
            ),
            types.Tool(
                name="annotate",
                description="Append a Python annotation to a reading record.",
                input_schema=contract_schema,
                output_schema=contract_schema,
            ),
        ]
        return types.ListToolsResult(tools=tools)

    async def call_tool(_ctx: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
        name = params.name
        arguments = params.arguments or {}
        if name not in ("classify", "annotate"):
            return failed("INTERNAL", "Unknown tool", "not-started")
        if not contract_validator.is_valid(arguments):
            return failed("CONTRACT_MISMATCH", "Input contract validation failed", "not-started")

        result = dict(arguments)
        notes = list(result["notes"])
        if name == "classify":
            result["severity"] = "review" if result["amount"] >= 60 else "normal"
            notes.append("classified")
        else:
            notes.append("python annotation")
        result["notes"] = notes

        if not contract_validator.is_valid(result):
            return failed("CONTRACT_MISMATCH", "Output contract validation failed", "failed")
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
            structured_content=result,
        )

    server = Server(
        MODULE_ID,
        version=VERSION,
        on_list_tools=list_tools,
        on_call_tool=call_tool,
    )
    server.extensions = {extension_id: {"descriptor": descriptor}}

    return server


async def serve() -> None:
    server = build_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(
                extensions={
                    os.environ.get("MMP_EXTENSION_ID", EXTENSION_ID_DEFAULT): {
                        "descriptor": build_descriptor()
                    }
                }
            ),
        )


def main() -> None:
    try:
        asyncio.run(serve())
    except Exception as exc:
        print(f"mmp-independent-python: {exc}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
