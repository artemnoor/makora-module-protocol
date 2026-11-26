# Module calls

The Gateway offers one reserved tool, `mmp_invoke`. Its [input schema](../../schemas/0.1.0/invoke.schema.json) defines `capability`, `inputContract`, `outputContract`, `arguments` and optional `idempotencyKey`. The successful structured result is `{outputContract,result}`. Gateway calls use a separate authenticated MCP connection. A caller-supplied identity is invalid.

The Gateway MUST check caller identity, active invocation binding, declared dependency, exact triple, grants, cycle/depth, deadline and trusted input data before dispatch. It MUST validate successful output before returning it. It MUST keep provider selection stable for the lifetime of the originating call. Within the deduplication window, the same logical key MUST be pinned to its original target. Missing selection is `DEPENDENCY_UNAVAILABLE`.

Hosts MAY implement different internal routing interfaces. The Reference Host transports an opaque, unguessable, short-lived reference in `_meta["io.github.artemnoor/mmp-context"]`. The Host resolves it to the [execution context](../../schemas/0.1.0/execution-context.schema.json) and checks that it belongs to the authenticated caller. The handle carries no authority on another connection or after the invocation completes.
