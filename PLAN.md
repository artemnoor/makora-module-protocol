# MMP 0.1

Use the 14-page R2 development guide as the requirements baseline. Maintain traceability in REQUIREMENTS.md. Each stage requires an independently reviewed diff, an isolated verification run and a repeat of the applicable checks in the source checkout.

| Ticket | Depends on | Acceptance |
| --- | --- | --- |
| MMP-00 | — | Standalone Spike using official SDKs and independently running TypeScript and Python modules. Reproduce all R2 page 12 conditions. Record exact versions, wire behavior, trace, latency and Go/No-go. |
| MMP-01 | MMP-00 | Freeze the tested MCP profile, descriptor/discovery, invoke, context, error model and compatibility rules. Provide schema/fixture/SDK consistency checks. |
| MMP-02 | MMP-01 | Thin TS SDK and Reference Host enforce discovery, trust, exact contracts, provider selection, invocation budgets, cancellation and deduplication. Verify trusted modules and contracts against pinned digests. |
| MMP-03 | MMP-02 | Independently run TS and Python modules using standard MCP. Demonstrate branching, join, interchangeable providers, explicit adaptation and a replaceable internal AI implementation. Check a real Makora module where available. |
| MMP-04 | MMP-03 | Black-box tests cover the negative and lifecycle scenarios in the requirements matrix. Verify baseline MCP client interoperability. |
| MMP-05 | MMP-04 | Complete release documentation, lockfiles and CI. Independently verify fresh setup, demo, lint, architecture, types, test suites and build. Review against every requirement and record evidence. |

The normative text and schemas define the interoperable boundary. SDK and host are consumers of that boundary. Examples use public SDK interfaces and MCP transports. The demo owns its graph decisions.
