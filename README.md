# Makora Module Protocol 0.1

MMP profiles MCP for independently versioned modules that can declare, consume and replace capabilities with exact semantic contracts. The normative profile is in [spec/0.1.0](spec/0.1.0/overview.md). The [transport Spike](spike/README.md) can be run independently of the reference implementation.

## Quickstart

Install Node.js 22.13 or later, Python 3.11 or later, and uv. From the repository root:

```sh
npm ci
uv sync --locked
npm run demo
npm run verify:release
```

The demo launches TypeScript and Python MCP modules as child processes and opens a Gateway on an ephemeral loopback port. The coordinator calls two research operations in parallel and sends their findings to a Python planner. The planner calls the TypeScript reviewer. The same request is then repeated with the alternate Python provider. The report includes the returned findings, both call chains and Gateway latencies.

The research module uses deterministic findings by default. To connect an inference service, set `MMP_RESEARCH_PROVIDER` to an operator-configured HTTPS or loopback HTTP endpoint that accepts POST JSON `{"topic":"..."}` and returns `{"findings":["..."]}`. The inference service chooses the model and owns its credentials. This endpoint is internal to the research module and does not alter its MCP descriptor or semantic contracts.

## Repository

The [Universality Lab](demos/universality/README.md) exercises different graphs, browser continuations, independently packaged modules and optional live models. It runs separately from the reference demo.

| Path | Contents |
| --- | --- |
| `spec/0.1.0/`, `schemas/0.1.0/` | Normative text and machine-readable shapes |
| `contracts/` | Semantic meaning, schemas, fixtures and digest pins |
| `sdk/typescript/` | MCP-based module SDK |
| `reference/host/` | Admission, policy, routing, context and deduplication |
| `examples/` | Independent TypeScript and Python module entry points |
| `conformance/`, `spike/` | Protocol, trust and interoperability verification |

The Reference Host is local and uses process-local deduplication. The draft uses the `org.example` namespace. The [compatibility matrix](spec/0.1.0/versioning.md) records the supported profile. See [security](SECURITY.md) for the deployment boundary and [requirements](REQUIREMENTS.md) for evidence.
