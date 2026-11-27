# Black-box Host conformance

The cases in this directory use only the public Host surface. They never import
`Catalog`, `Registry`, `startHost` or a Python Host class. The same test files run
against every implementation selected by `MMP_CONFORMANCE_HOST`.

```sh
npm run verify:hosts                  # TypeScript and Python, fails on either
npm run verify:hosts:typescript       # local TypeScript-only run
node conformance/verify.mjs --hosts=python
```

`verify:hosts` builds the package, runs each Host in a separate Node test process
and prints an explicit per-Host summary. A missing Python Host is a failure, not
a skip. The TypeScript implementation is selected through
`conformance/host-adapters/typescript.mjs`, a thin wrapper around `startHost`.

## Python bridge

`conformance/host-adapters/python.mjs` starts `conformance/python-bridge.py` as a
child process and speaks newline-delimited JSON over its standard streams. The
bridge imports `Host` and `MMPError` from `python-host` and is the only place
that knows the Python package layout. It searches `MMP_PYTHON_HOST_DIR`,
`./python-host` and `../python-host`, then uses `python-host/.venv` directly or
`uv run --project python-host --locked python`. `MMP_PYTHON` can override the
bridge interpreter for diagnostics or fixtures; normal runs do not need it.

The bridge always runs with `-X utf8`, `PYTHONUTF8=1` and
`PYTHONIOENCODING=utf-8:strict`, and it reconfigures its own stdin, stdout and
stderr to UTF-8. This keeps non-ASCII workspace and package paths intact on
Windows even when the process locale is cp1251. `bridge.encoding.test.mjs` is a
focused integration check for that path and for the MMP error/failure split.

The adapter maps the public TypeScript `HostConfig` to the Python config:

| TypeScript | Python |
| --- | --- |
| `catalog: [{file, digest}]` | `contracts: [{id, file, sha256}]`, `id` from `schema.$id` |
| `packages: [{moduleEnvironment, files, root, ...}]` | `providers: [{env, files, root, cwd, ...}]` |
| `maxDepth`, `maxDurationMs` | `maxDepth`, `timeoutSeconds` |
| fixed profile limits | `address`, `maxMessageBytes`, `maxDataDepth` |

Only a real `MMPError.as_dict()` becomes an MMP wire error. A bridge crash, a
pre-start host exception or a raw `asyncio.CancelledError` is reported as a
test failure; the adapter does not synthesize `kind`, `retryable`, `outcome` or
`correlationId`. Correlation IDs are asserted as non-empty opaque strings, not
as UUIDs, so a valid Python identifier is accepted. Provider `select` is
normalised to an awaited call so both adapters have the same contract.

`MMP_CONFORMANCE_HOST=typescript|python` selects the target. The shared cases
cover discovery and admission, digests and schemas, default deny, protected
tools, contract mismatch, valid and invalid data, deadlines, cancellation,
cycles, maximum depth, sibling overlap, deduplication and provider replacement,
the authenticated Gateway context rules and the same JSON graph runner used by
`experiments/release`.
