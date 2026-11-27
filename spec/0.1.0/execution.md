# Execution

The Host assigns an opaque correlation ID, active capability chain, absolute Unix deadline in milliseconds and finite depth limit. Each branch owns its active chain. A repeated capability on that chain is a cycle. The Gateway MUST allow unrelated sibling work without a lock held across downstream calls.

A child deadline MUST be at or before the parent's. Use MCP cancellation for active descendants and stop dispatching when the budget or parent invocation ends. Cancellation is best effort. It cannot establish that an effect was rolled back. A missing execution result following a dispatched timeout or cancellation has outcome `unknown`.

MCP transport and protocol errors retain upstream meaning on the connection where they occur. An HTTP authentication, authority or Origin rejection occurs before the MCP layer and is reported with its HTTP status, not as an MMP error result. When a syntactically valid Gateway call fails because the downstream tool connection or downstream MCP request fails, report an MMP operation failure on the original caller's connection.

Authority follows the layer that observed the failure:

- A call rejected before dispatch — invalid `mmp_invoke` request, undeclared dependency, missing selection, failed grant, cycle, depth, expired deadline or cancellation — is an MMP failure with outcome `not-started`.
- A downstream result that is an MMP error with a valid error profile is reissued with the same kind and outcome and the Host's correlation ID. The provider's correlation ID is not propagated.
- A downstream error result whose MMP error profile is missing, unbounded or invalid, and a downstream transport or protocol failure, map to `INTERNAL` with outcome `unknown`, unless a deadline or cancellation determines the failure kind.
- A dispatched call whose successful result fails trusted output validation is `CONTRACT_MISMATCH` with outcome `unknown`.

This classification covers the Gateway `mmp_invoke` request and MMP checks. A provider's MCP framework may reject malformed business-tool arguments before its handler runs; MMP does not require that rejection to be an MMP error result.

A downstream protocol error does not describe the syntax or method of the original Gateway request. MMP adds no automatic retry and no argument coercion: the Gateway forwards `arguments` unchanged and the selected provider's MCP implementation decides its own argument handling.

An MMP execution failure uses `isError: true`, human-readable content, and the [MMP error profile](../../schemas/0.1.0/error.schema.json) in `_meta["io.github.artemnoor/mmp-error"]`. The success output schema does not apply to error results. A retryability hint does not grant permission to retry. The Host records outcome as `not-started`, `failed` or `unknown`, according to available evidence.

Modes are `none`, `natural`, and `deduplicated`. A deduplicated lookup key is the authenticated caller, the exact triple (`capability`, `inputContract`, `outputContract`) and `idempotencyKey`. The stored record holds the canonical `arguments` and the pinned provider module ID, exact version and tool. `idempotencyKey` is required for a deduplicated operation; a deduplicated call without one fails with `IDEMPOTENCY_CONFLICT`. Modes `natural` and `none` do not promise a saved result or a pinned target, even when a key is supplied. Object-key ordering does not affect equality. Array order and JSON value types are significant, and numbers compare as JSON numbers. A retained key with different arguments or a different pinned provider MUST fail with `IDEMPOTENCY_CONFLICT`, including after a replacement is selected while the record is retained. Duplicate calls share the in-flight result or a saved terminal result and MUST NOT start the effect again. The provider declares retention and whether the state survives restart. The Reference Host supports process-local state only and rejects a persistent guarantee. Retention starts when the attempt terminates. There is no replay guarantee after expiry or process restart.
