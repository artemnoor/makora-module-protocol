# MMP Python Host

Independent async MMP 0.1 Host for Windows and POSIX. It uses the official
`mcp` Python SDK 2.3.0 for stdio provider discovery and tool calls and serves
the module-facing Gateway as a loopback Streamable HTTP MCP server. The public
API is `mmp_host.Host`; the package has no AI, workflow or TypeScript runtime
dependency.

## Install

CPython 3.12 is the verified interpreter for this revision. From this
directory:

```powershell
uv sync --locked --python 3.12
```

`uv.lock` is the only lockfile. The runtime dependencies are pinned there and
in `pyproject.toml`.

## Async API

```python
from mmp_host import Host

host = await Host.start({
    "contracts": [{
        "id": "urn:mmp:starter:message:1.0.0",
        "file": "contract.json",
        "sha256": "<trusted sha256>",
    }],
    "providers": [{
        "id": "org.example.echo",
        "publisher": "org.example",
        "version": "1.0.0",
        "root": "/absolute/package/root",
        "command": "/absolute/python",
        "args": ["server.py"],
        "files": {"server.py": "<sha256>", "contract.json": "<sha256>"},
    }],
    "knownPermissions": [],
    "grants": [{
        "caller": "host:app",
        "target": "org.example.echo",
        "tool": "echo",
        "effects": "read-only",
        "permissions": [],
    }],
    "address": ["127.0.0.1", 0],
})
try:
    result = await host.invoke("host:app", {
        "capability": "org.example/echo",
        "inputContract": "urn:mmp:starter:message:1.0.0",
        "outputContract": "urn:mmp:starter:message:1.0.0",
        "arguments": {"message": "Hello"},
    })
    print(result["result"])
finally:
    await host.close()
```

`Host.start(config)` loads and digest-checks contract artifacts, starts the
loopback Gateway, then admits providers. The public async operations are
`invoke`, `add_provider`, `remove_provider`, `select` and `close`; `gateway`
exposes the authenticated MCP URL.

### Provider launch pinning

- `command` must be an absolute path to the trusted runtime.
- `args[0]` must be a relative launch entry and its path must appear in
  `files`, so the exact bytes are pinned before launch. When `args` is empty,
  the absolute `command` itself must be pinned under `root`.
- Every `files` entry is relative to `root` (or the command directory), cannot
  escape that directory, and is rejected if any lexical component is a
  symlink or `..`.
- The Host injects `MMP_GATEWAY`, `MMP_CREDENTIAL` and `MMP_HOST_GRANT` into
  each provider environment. Provider-supplied values for those keys are
  ignored.

### Gateway and failures

- The listener is loopback-only. The `Host` header must equal the bound
  `127.0.0.1:<port>` authority. A non-matching `Origin` is rejected with
  `403` before Bearer authentication; a missing or wrong Bearer credential is
  `401`.
- `mmp_invoke` uses the canonical `invoke.schema.json`. Its success
  `outputSchema` describes exactly `{outputContract, result}`.
- Downstream MMP errors that satisfy `error.schema.json` keep their `kind` and
  `outcome` with the Host correlation ID. Other downstream failures become
  `INTERNAL` with outcome `unknown`.
- Request and response JSON is bounded by `maxMessageBytes` and
  `maxDataDepth`. Deadlines are absolute Unix milliseconds; an expired
  deadline, including `0`, fails `not-started` before dispatch.
- Deduplication is process-local. Terminal entries are retained for the
  declared `retentionSeconds`; pruning removes only expired entries. A new
  deduplicated dispatch is rejected before it starts when
  `maxDedupEntries` is full, while retained replays and conflicts remain
  available. A retained logical key conflicts with any different pinned
  target, even if the replacement operation uses `natural` or `none`
  idempotency.
- An active root call keeps its admitted provider objects. If a provider is
  removed or re-admitted under the same module ID mid-call, dispatch is
  rejected instead of silently using the replacement.

### Cancellation

Calling `Task.cancel()` on an `invoke` cancels the downstream SDK operation
best-effort and surfaces `MMPError(kind="CANCELLED", outcome="unknown")` once
dispatch has occurred. `MMPError.as_dict()` returns the normative error
profile.

## Tests

```powershell
uv sync --locked --python 3.12
uv run --locked python tests/integration.py
ruff check --select E,F,I,UP,B,C4,RUF,TRY,BLE --ignore E501 mmp_host tests
```

`tests/integration.py` starts two stdio fixture providers and checks root,
parallel, nested Gateway calls, typed downstream failures, deadline,
cancellation, deduplication capacity and retention, provider generation
changes, exact `403`/`401` ordering, the canonical Gateway schemas and launch
pinning. `tests/fixtures` is test-only; it is not installed.

CPython 3.12.16 on Windows is verified. CPython 3.11, 3.13 and 3.14 were not
verified for this revision.
