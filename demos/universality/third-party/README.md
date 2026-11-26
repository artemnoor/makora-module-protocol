# Independent Python decorator

This standalone package implements the `org.example/universal.decorate` capability with the official Python MCP SDK. It does not import MMP repository code. Both sides declare `urn:mmp:universal:document:1.0.0` for input and output.

The contract is supplied by the demo environment through `MMP_DEMO_CONTRACT`. The path may contain a bare JSON Schema or an envelope with a top-level `schema` member. The module uses that schema for MCP tool discovery and validates both the received arguments and returned object.

## Run

From this directory, with [uv](https://docs.astral.sh/uv/) installed:

```powershell
$env:MMP_DEMO_CONTRACT = "C:\path\to\document-contract.json"
uv sync --locked
uv run --locked mmp-independent-decorator
```

The process serves MCP over stdio. Its descriptor identifies provider `org.example.independent-decorator`, publisher `org.example`, version `1.0.0`, and operation `decorate`. The operation returns the input object with `Independent Python contribution` appended to `notes`.
