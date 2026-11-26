# MCP transport Spike

From this directory run:

```sh
npm ci
uv sync --locked
npm run check
```

Tested with Node 22.13, Python 3.14.6, official MCP TypeScript client/server 2.4.0 and Node adapter 2.1.2, and Python MCP 2.3.0. All three subprocesses use stdio. The modules make independent authenticated Streamable HTTP calls to the loopback Gateway. Both standard discovery and tool listing work at MCP 2026-07-28. Extension settings carry the descriptor metadata in both SDKs. The TypeScript server uses `capabilities.extensions` and the Python server uses `Extension.settings`. The Node adapter carries request metadata and maps the request's lifetime to the SDK.

The seven tests exercise discovery and ordinary MCP, TS→Python and Python→TS nested calls, parallel branch/join and replacement, cycle and depth, default deny, deadline and actual cancellation of a Python tool handler. The concurrency test checks the relative start/finish order and a correlation ID across both branches. The Host captures Gateway latency from a monotonic clock and omits credentials from trace records.

Go for the tested topology. The Spike uses illustrative descriptors and contracts. Descriptor admission, full policy and deduplication belong to the Reference Host.

Baseline upstream samples were run separately in a scratch copy. The unchanged [TypeScript stdio harness](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/examples/guides/serving/stdio.examples.ts) passed its legacy handshake and stdout/stderr assertions. The unchanged [Python echo server](https://github.com/modelcontextprotocol/python-sdk/blob/v2.3.0/examples/mcpserver/simple_echo.py) was served over stdio and returned `{"result":"upstream echo"}` through the official TypeScript client pinned to 2026-07-28.
