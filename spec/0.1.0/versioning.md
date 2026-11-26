# Versioning and compatibility

MCP revision, MMP profile, module package version and semantic contract version are independent. MMP detects only the supported profile after validation. It does not upgrade incompatible profiles implicitly. A profile change is a new published ID, and a package may evolve while preserving its triples. Incompatible draft changes are recorded before new tags.

| Component | Pinned version | Evidence |
| --- | --- | --- |
| MCP | 2026-07-28 | Discovery and revision assertion in Spike |
| TypeScript SDK | client/server 2.4.0, Node adapter 2.1.2 | Stdio, Streamable HTTP and conformance |
| Python SDK | mcp 2.3.0 | Discovery, stdio provider and outgoing HTTP client |
| MMP | 0.1.0 | `io.github.artemnoor/mmp` discovery, schemas, Host and tests |
| MCP fallback | Legacy client call to public business tool | Black-box conformance |
| Makora Penpot | MCP 2025-06-18 | Local connector completed legacy handshake and tools/list. It advertises no MMP extension. |
| Tasks / MRTR | Outside sync profile | No capabilities claimed |

Use both lockfiles and rerun the Spike and conformance on a revision or SDK change.

Pre-release implementations using `org.example/mmp` MUST migrate discovery and MMP metadata keys to the release namespace. Example capability and semantic contract IDs keep their existing values. The Reference Host matches the release extension ID exactly.
