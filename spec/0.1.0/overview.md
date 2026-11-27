# MMP 0.1.0 specification

MMP defines an interoperable MCP profile for modules. A module advertises versioned operations and dependencies. A Host admits trusted modules and resolves exact capability and contract pairs under caller-specific policy. A module that consumes a dependency issues an MCP tool call over a separate connection to the Host's Gateway.

The keywords MUST, SHOULD and MAY have the meaning in BCP 14. The schemas under `schemas/0.1.0` define the JSON shapes. Implementations MUST satisfy the behavioral rules and schema constraints together.

- [MCP profile](mcp-profile.md)
- [Descriptor and discovery](descriptor.md)
- [Semantic contracts](contracts.md)
- [Module calls](module-calls.md)
- [Execution](execution.md)
- [Security](security.md)
- [Versioning](versioning.md)

The Host owns admission, policy, routing and execution state for an invocation. Graph policy — which operations to call, in what order, on what data and how to handle partial results — belongs to the application, not to the Host or Gateway. MMP therefore leaves graph construction, retries, scheduling and partial-result handling to the application. Module internals may use ordinary code or a model. Sync MMP requires the standard MCP success result and an explicit error profile.
