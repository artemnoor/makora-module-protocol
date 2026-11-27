# Implement an MMP Host

[Specification](../spec/0.1.0/overview.md) · [Developer guide](developer-guide.md) · [Release report](release-0.1.0.md)

This guide is informative. The [specification](../spec/0.1.0/overview.md) and the [four JSON Schemas](../schemas/0.1.0/) are normative. It describes the behavior a Host must implement and the evidence needed to claim compatibility. It makes no assumption about the Host's programming language, runtime, deployment model or use of AI.

## Status and evidence

MMP 0.1.0 uses MCP 2026-07-28 and the extension identifier `io.github.artemnoor/mmp`. Install the TypeScript distribution with `npm install @artemnoor/mmp@0.1.0`. The [developer guide](developer-guide.md#install-the-sdk) also covers testing a local archive.

Compatibility evidence is reported separately from this guide:

- The TypeScript Reference Host passes the shipped conformance suite and the transport Spike. The [release report](release-0.1.0.md) records the results and the tested topology.
- Independently authored Node and Python providers ran against the installed SDK and the public Host API in a directory outside the checkout. The [experiment](../experiments/release/README.md) contains the reproduction driver.
- The public registry consumer check installs the package into an empty project, compiles a strict TypeScript module from the public exports and calls it through the Reference Host. Run `node experiments/release/sdk-consumer.mjs @artemnoor/mmp@0.1.0`.
- The TypeScript and Python Host conformance suites passed on Windows, including the bridge test. The [release report](release-0.1.0.md) records the results.

Use the evidence as a record of tested behavior, not as a claim that every deployment or every language binding has been verified. Record your own results by MCP revision, MMP profile and package pins.

## 1. Roles and boundaries

A **Host** is the application-side authority. It admits modules, stores the trusted contract catalog and policy, exposes a Gateway, resolves calls and records execution state. A **module** is an MCP server that publishes an MMP descriptor. A **Gateway** is the MCP server the Host exposes to modules for outbound dependency calls.

The application still owns graph construction, scheduling, retries, user checkpoints, interfaces and model connections. MMP does not define a workflow language, a UI protocol or a model API. A module may contain ordinary deterministic code, an external service, a model-backed operation or a user-facing component; the Host treats them the same way at the protocol boundary.

The Host has two distinct connections:

1. The **module-side connection**, from the Host to each module. A Host may choose stdio or Streamable HTTP under its trust policy.
2. The **Gateway connection**, initiated by a module back to the Host for `mmp_invoke`. It is a separate authenticated MCP connection, not the module-side connection.

Do not conflate the two directions. A failure on a downstream module connection and a malformed Gateway request are different events with different reporting rules.

## 2. Transport

Use the upstream MCP transports, message envelope, discovery, `tools/list`, `tools/call` and cancellation at MCP 2026-07-28. Do not invent a parallel envelope. The Gateway must be a normal MCP server on a connection initiated by the module. The reserved Gateway tool is `mmp_invoke`.

For a successful business call, a module returns an MCP success result whose `structuredContent` is a JSON object satisfying the declared output contract. The Gateway returns `{ "outputContract": "<contract id>", "result": <validated object> }` to the caller.

A module advertises its descriptor at `capabilities.extensions["io.github.artemnoor/mmp"].descriptor` in `server/discover`. The `io.github.artemnoor` prefix identifies the project namespace and its metadata keys. Capability namespaces belong to the module publisher or a shared naming authority.

The Reference Host chooses private stdio for module processes and an authenticated Streamable HTTP Gateway bound to `127.0.0.1`. It rejects a different `Host` authority or an invalid `Origin` before authentication, bounds request size, and injects the Gateway URL, credential and protected-tool grant into the module environment. These are reference design choices that satisfy the normative rules. An alternate Host may use another transport or another trusted protected-tool design, but it must still authenticate the caller, bind the invocation context, enforce policy and protect the installed artifacts.

Outside a trusted local boundary, an HTTP deployment must authenticate and authorize over TLS. Do not expose the loopback Gateway as a public endpoint. Stdio is a process boundary, not a sandbox.

## 3. Trust

Policy is configured separately from the descriptor and is default-deny. A valid descriptor is descriptive, never authorization. Assess the target operation and **each immediate authenticated caller**. Do not inherit an upstream caller's grants.

Admission trust rests on operator-controlled artifacts:

- Pin the module identity, publisher claim, package version and the exact file digests of deployed code and contract artifacts.
- Verify contract digests from trusted configuration before compiling schemas. Reject external schema references and resolve no schema over the network.
- Keep package directories and dependency installation immutable for the lifetime of the deployment.
- Treat tool output as untrusted data until it passes the trusted output contract.
- Give each module its own short-lived Gateway credential and a distinct Host-to-module grant over a private channel. Keep both out of operation arguments, results and logs.
- Make a protected tool reject a direct MCP call that lacks the Host authorization. Run policy and deduplication before supplying the grant.
- Run untrusted code only with actual OS-level network and filesystem isolation.

The reference environment accepts trusted local artifacts. A deployment that accepts untrusted programs must provide its own isolation, process recovery and durable state where it claims them.

## 4. Identity and authority

An MMP module identity is the descriptor `id` together with its publisher claim, package version and the operator's pin. The Host must derive the authenticated caller from the connection credential or process launch, not from a field supplied by the caller during a business call. A caller-supplied identity is invalid.

The Host assigns identities to root callers, such as `host:<application>`. The Reference Host rejects a root caller whose name does not start with `host:` and rejects a caller that collides with an admitted module. An alternate Host may define its own root principal namespace, but it must keep root principals distinct from module identities.

The Gateway authenticates the module, then checks:

- The authenticated module is the one the context belongs to.
- The invocation names a dependency the module declared in `requires`.
- The exact capability and both contract IDs match a routed operation.
- The configured grant permits this immediate caller, target tool, effects and required permissions.
- The active chain, depth and deadline permit the call.

The Reference Host transports an opaque, unguessable, short-lived context reference in `_meta["io.github.artemnoor/mmp-context"]`. The Host resolves it to the execution context and verifies the authenticated owner. The handle carries no authority on another connection or after the invocation ends. A different Host may use another internal routing interface, provided the binding is equally strict.

Grant scope includes the immediate caller, target module and tool, effects and permissions. Replacing a provider does not transfer authority implicitly. A Host that lets an operator select another provider must require a compatible triple and a grant that covers the replacement, and must keep the selection stable for the originating invocation.

## 5. Admission

Reject a module before it serves traffic unless all checks pass. At minimum, verify:

| Boundary | Observable requirement |
| --- | --- |
| Revision | The negotiated MCP revision is 2026-07-28. Reject an unsupported revision instead of upgrading it implicitly. |
| Extension | Discovery contains the exact `io.github.artemnoor/mmp` extension with a descriptor. An ordinary MCP server may serve public read-only tools, but it does not become an MMP provider. |
| Descriptor | The descriptor validates against `module-descriptor.schema.json`, declares the supported MMP version, and corresponds to the deployed package. |
| Names | Tool names and operation triples are unique. Reserved `mmp_` names are rejected. |
| Schemas | Every advertised input and output schema matches the trusted catalog structurally. Object-key order is irrelevant; schema meaning and constraints are not. |
| Digests | Package files and contract artifacts match the pinned SHA-256 values. Compilation uses only trusted, local schema resources. |
| Policy surface | Permission names are known to the Host, effects are one of `read-only`, `write` or `external`, and the execution mode is supported. |
| Idempotency | The declared mode and retention are supported. Reject a `restartPersistent` guarantee that the Host cannot keep. |
| Identity | The package identity and version match the operator pin and the authenticated process or connection. Duplicate module IDs are rejected. |

The shipped admission, dispatch and execution tests are useful vectors. They cover missing and draft extension descriptors, an unsupported MMP version, reserved tool names, unknown permissions, persistent deduplication claims, schema mismatches, package and contract digest failures, malformed outputs and idempotency conflicts. Verify the equivalent behavior of your own admission path rather than assuming the reference results transfer.

## 6. Routing and execution

Resolve a call by the exact triple `(capability, inputContract, outputContract)`:

- No provider for the capability or triple: `DEPENDENCY_UNAVAILABLE`.
- A provider exists for the capability but not for those exact contracts: `CONTRACT_MISMATCH`.
- Provider and contracts match: continue to policy and data validation.

Validate arguments against the trusted input contract before dispatch. Validate a successful `structuredContent` against the trusted output contract before returning it. The success output schema does not apply to an error result.

Assign an execution context with a correlation ID, an absolute Unix deadline in milliseconds, a finite depth limit and an active capability chain. Each concurrent branch owns its own chain. A repeated capability on one chain is a cycle. A child deadline must be at or before its parent's. Unrelated sibling work must be allowed to proceed without a lock held across downstream calls.

Cancellation is best effort and does not prove that an effect was rolled back. A missing result after a dispatched timeout or cancellation has outcome `unknown`. Do not report a downstream protocol error as an error in the syntax or method of the original Gateway request: transport and protocol errors retain their meaning on the connection where they occur. When a syntactically valid Gateway call fails because a downstream tool call fails, report an MMP operation failure on the original caller's connection.

An MMP execution failure uses `isError: true`, human-readable content and the error profile in `_meta["io.github.artemnoor/mmp-error"]`, validated against `error.schema.json`. Record outcome as `not-started`, `failed` or `unknown` according to the available evidence. A retryability hint is advice, not permission to retry.

Idempotency modes are `none`, `natural` and `deduplicated`:

- For `deduplicated`, the logical scope includes the authenticated caller, pinned target module/version/tool and key.
- Object-key ordering does not affect equality. Array order and JSON value types are significant.
- A retained key with different arguments or a different pinned provider must fail with `IDEMPOTENCY_CONFLICT`.
- Concurrent duplicates share the in-flight result; terminal duplicates share the saved result. The effect must not start again.
- Retention starts when the attempt terminates. There is no replay guarantee after expiry or process restart.
- The provider declares retention and whether state survives restart. The Reference Host keeps deduplication in process memory and rejects a persistent guarantee.

Keep provider selection stable for the lifetime of the originating root call. Within a deduplication window, keep the same logical key pinned to its original target. A Host may apply its own global limits on message size, data depth, call depth, duration and deduplication entries; declare those limits and reject invalid configuration at startup.

## 7. Black-box testing

Test observable protocol behavior, not internal modules. The [shared conformance suite](https://github.com/artemnoor/makora-module-protocol/blob/main/conformance/README.md) uses only the public Host API and the normative MCP/MMP wire shapes. `npm run verify:hosts` runs it against both implementations through a thin TypeScript adapter around `startHost` and a JSONL bridge adapter to the [Python Host](https://github.com/artemnoor/makora-module-protocol/blob/main/python-host/README.md). A missing Python Host or dependency is a failure, not a skip. `npm run verify:external:hosts` runs the same JSON graphs, modules and assertions through both Hosts in an isolated workspace. The specification and schemas remain the normative boundary; the adapters are test harnesses, not additional contracts. The transport [Spike](../spike/README.md) separately exercises MCP discovery, stdio, authenticated Streamable HTTP and nested cross-language calls.

The tests do not need AI. Use deterministic modules with fixed inputs and outputs. A model-backed module is just another module under the same protocol; keep its model connection behind the module boundary and do not make conformance depend on a provider credential.

| Scenario | Observable result |
| --- | --- |
| Discovery | A conforming module is visible at MCP 2026-07-28 with a valid descriptor and listed tools. |
| Admission rejects | Wrong revision, draft extension, missing descriptor, duplicate tool, unknown permission, wrong digest and unsupported idempotency claim are rejected. |
| Ordinary MCP | A legacy client can call a public read-only tool but cannot enroll a provider or obtain privileged context metadata. |
| Exact dispatch | A caller gets a result only for a declared, granted, exact triple. A different contract fails. |
| Nested call | A module calls a dependency through a new authenticated Gateway connection with a caller-bound context. |
| Replacement | A second provider with the same triple can be selected before a new root call, with its own identity and grant. |
| Cycles and depth | A repeated capability on one chain and an over-depth chain fail with the declared MMP error. |
| Deadline and cancellation | A bounded call stops dispatching, propagates cancellation best effort and reports a missing effect as `unknown` where applicable. |
| Output validation | A malformed or contract-violating success result is not returned as a successful business result. |
| Idempotency | Duplicate calls return the same terminal result without repeating the effect; conflicting arguments or targets fail. |
| Trust | A direct call to a protected tool without Host authorization fails; cross-caller context reuse fails; loopback origin checks apply as configured. |

Record the environment with every run: repository revision, MCP revision, MMP profile, package pins, Host language and runtime, transport choices, execution limits, deduplication behavior and the exact commands. Run `npm run verify:release`, `npm run verify:hosts`, `npm run verify:external`, `npm run verify:external:hosts` and the Spike as reference checks in a checkout; do not claim their results for an untested Host.

## 8. Compatibility claims

MCP revision, MMP profile, module package version and semantic contract version are independent. Do not upgrade an incompatible profile or contract implicitly. A profile change is a new published ID. A package may evolve while preserving its triples. An incompatible representation or meaning requires a new contract ID and an explicit adapter operation.

Declare the profiles and revisions your Host supports, including any implementation-specific behavior such as durable deduplication, process recovery, UI hosting or isolation. Keep those claims separate from the protocol baseline. Report compatibility evidence by revision and by tested topology; link the run that produced it. The current 0.1.0 evidence covers the Reference Host, the transport Spike, the independent provider experiment, both external language matrices and both Host conformance suites. The [release report](release-0.1.0.md) records the results.

For the public SDK surface, schema names and a clean consumer procedure, see the [developer guide](developer-guide.md#install-the-sdk). For module-side rules, start with the [MCP profile](../spec/0.1.0/mcp-profile.md), [descriptor](../spec/0.1.0/descriptor.md), [module calls](../spec/0.1.0/module-calls.md), [execution](../spec/0.1.0/execution.md) and [security](../spec/0.1.0/security.md) chapters.
