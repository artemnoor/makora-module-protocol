# Independent Python MMP provider

A small, read-only MMP 0.1.0 provider using the official `mcp==2.3.0` low-level `Server` API over stdio. The provider exposes `org.independent/classify` and `org.independent/annotate`.

## Run

Set `LAB_CONTRACT` to a JSON file whose top-level `schema` property is the shared Draft 2020-12 reading contract schema, then run:

```powershell
uv run mmp-independent-python
```

The advertised contract ID is `urn:mmp:independent:reading:1.0.0` for both input and output. `MMP_EXTENSION_ID` selects the MCP extension key and defaults to `io.github.artemnoor/mmp`. The extension settings contain the public MMP module descriptor.

`classify` sets `severity` to `review` when `amount >= 60`, otherwise `normal`, then appends `classified` to `notes`. `annotate` preserves the input fields and appends `python annotation` to `notes`. Both validate arguments and results with the schema loaded from `LAB_CONTRACT`.
