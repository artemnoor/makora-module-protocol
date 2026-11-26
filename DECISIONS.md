# Decisions

## 001. Candidate MCP profile for Spike

Evaluate 2026-07-28 with official TypeScript client/server 2.4.0 and Python mcp 2.3.0. Pin the protocol in the tests and record actual discovery and request behavior. A module is an MCP server for inbound tools and a separate MCP client for the Host Gateway. Candidate local topology is private stdio for Host-to-module calls and authenticated loopback Streamable HTTP for Gateway access. MCP wire messages stay with the official SDKs.

The Gateway derives identity from its authenticated connection and resolves opaque per-invocation context against host-side state bound to that identity. Each active chain is independent. Compute the child deadline under the parent deadline and propagate cancellation through SDK-supported APIs. Check descriptor discovery through MCP extension metadata first. Use the reserved descriptor tool only if the tested metadata path falls short. Confirm each of these choices through the Spike before making it normative.

References: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports and https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.

## 002. Repository boundaries

`spec/` and `schemas/` describe the protocol. `contracts/` supplies trusted data definitions. `sdk/typescript/` binds the public protocol to MCP. `reference/host/` owns the registry, trust decisions, routing and execution state, with SDK transports at its boundary. Independently launched examples consume public interfaces. `conformance/` drives real entry points. Keep `spike/` reproducible and independent from the release runtime.

## 003. Confirmed wire choices

Use MCP 2026-07-28 on both MMP links. Use private stdio for the reference module processes and authenticated loopback HTTP for their outgoing calls. TS and Python carried complete example descriptors under extension settings. The Node SDK adapter preserves upstream HTTP framing and request cancellation. Keep `org.example` for the draft, with stable naming subject to ownership confirmation. Preserve the ordinary MCP fallback for public tools.

Deduplication state in the Reference Host is process-local. A host MUST reject a module's persistence claim when that host cannot honor it. Expiry starts at termination. Use an in-memory promise for parallel replay, and bind the logical caller/key to the original target until expiry.

## 004. Release namespace and public archive

The protocol namespace is `io.github.artemnoor`, derived from the verified repository owner's GitHub account namespace. Publish the wire keys and migration from the draft explicitly. The standalone npm archive exports the SDK, Reference Host and JSON Schemas; its consumers can run in a separate project. See the [release candidate report](docs/release-0.1.0.md).
