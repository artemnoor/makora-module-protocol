# Module calls

The Gateway offers one reserved tool, `mmp_invoke`. Its [input schema](../../schemas/0.1.0/invoke.schema.json) defines `capability`, `inputContract`, `outputContract`, `arguments` and optional `idempotencyKey`. The successful structured result is `{outputContract,result}`. Gateway calls use a separate authenticated MCP connection. A caller-supplied identity is invalid.

The Gateway MUST check caller identity, active invocation binding, declared dependency, exact triple, grants, cycle/depth, deadline and trusted input data before dispatch. It MUST validate successful output before returning it. It MUST keep provider selection stable for the lifetime of the originating call. Within the deduplication window, the same logical key MUST be pinned to its original target. After the dependency check, an exact triple with no selected provider is `DEPENDENCY_UNAVAILABLE`; a selected capability with a different exact triple is `CONTRACT_MISMATCH`.

Hosts MAY implement different internal routing interfaces. The Reference Host transports an opaque, unguessable, short-lived reference in `_meta["io.github.artemnoor/mmp-context"]`. The module echoes that reference on its separate Gateway connection. The Host resolves it to the [execution context](../../schemas/0.1.0/execution-context.schema.json) only when it names a live invocation whose authenticated module identity matches the Gateway caller. The reference alone conveys no authority; it cannot be reused after the invocation completes or by another module. A protected Host-to-module call also carries `_meta["io.github.artemnoor/mmp-grant"]` with the distinct grant value.

## Local launch binding

A Host that launches a local module and expects existing modules to remain portable supplies three distinct values over the private process boundary:

- `MMP_GATEWAY` is the absolute MCP endpoint URL the Gateway is actually listening on. A local HTTP deployment selects its loopback port and path and passes the resulting URL; the Reference Host uses `http://127.0.0.1:<port>/mcp`.
- `MMP_CREDENTIAL` is the module-specific HTTP Bearer credential for that Gateway endpoint.
- `MMP_HOST_GRANT` is a separate secret that authorizes protected Host-to-module operations.

A module MUST use `MMP_GATEWAY` verbatim for its outbound Gateway connection and MUST send `MMP_CREDENTIAL` as the HTTP Bearer credential. It MUST treat `MMP_HOST_GRANT` as authorization for inbound protected operations, never as a Gateway credential. The credential and grant MUST NOT appear in operation arguments, results or logs.

These names, their distinctness and these meanings are the portable local binding. Existing modules remain portable only to a Host that supplies this binding together with the per-request metadata keys above. A different launch variable set, transport endpoint convention or protected-tool design is an alternate deployment and MUST be configured by mutual agreement; it is not inferred from discovery.
