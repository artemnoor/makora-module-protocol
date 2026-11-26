# Requirements and evidence

Source: MMP 0.1 Development Guide R2, pages 2–14, and the Codex objective attachment. See PROGRESS.md for the final commands and limitations.

| ID | Requirement | Required evidence |
| --- | --- | --- |
| MMP-R01 | Standalone MCP profile using official SDKs, pinned versions and revisions | Spike discovery on MCP 2026-07-28. Official TS stdio harness and Python echo checked separately. See [Spike](spike/README.md). |
| MMP-R02 | Valid descriptor, extension discovery, reserved name handling and tools/list consistency | Modern extension discovery in Spike and host admission tests for missing, malformed, mismatched and reserved values. |
| MMP-R03 | Capability namespace and exact versioned input/output semantics, explicit adapter for differing semantics | Host conformance checks the unchanged coordinator with both providers and conversion of 3 RUB to 300 kopecks. |
| MMP-R04 | Trusted local catalog, immutable digest, meaning, fixtures and golden cases | Six pinned artifacts with positive/negative fixtures. Admission tests reject wrong digest, advertised shape and remote references. |
| MMP-R05 | Input and structured success output match trusted schemas | Host conformance rejects invalid input and separate fixture output. Ordinary MCP client calls a read-only tool. |
| MMP-R06 | `mmp_invoke` on separate Gateway connection with exact contract pair and `{outputContract,result}` | Bidirectional nested calls in Spike. Host test verifies the Python planner callback into the TS reviewer and missing dependency. |
| MMP-R07 | Default-deny, bound caller identity, declared dependency, known grants and effects | Host policy tests, protected direct-call denial, and Spike test using the authenticated identity of a different module with an active context. |
| MMP-R08 | Trusted publisher/version/package digest, no remote schema references, execution/data bounds | Pinned local artifact hashes, request and data bounds, spec/security.md and digest rejection tests. |
| MMP-R09 | Host-owned correlation ID, active chain, maximum depth and deadline | Spike asserts sibling overlap and correlation ID, rejects depth/cycles and captures measured latency. Demo logs nested chain. |
| MMP-R10 | Deadline bound and best-effort cancellation propagated to active descendants | Expiry and cancellation cases pass in Spike and conformance. Python handler emits its actual cancellation observation. |
| MMP-R11 | MCP protocol errors and separate namespaced MMP execution errors | Structured operation failures and validated metadata are covered by conformance. Ordinary MCP legacy path stays readable. |
| MMP-R12 | Natural/none/deduplicated modes, pinned target, canonical arguments and effect protection | Conformance covers parallel replay, arguments, caller scope, retention, target replacement, Gateway path and process restart. |
| MMP-R13 | Independent TS/Python examples with parallel fork/join, replacement, explicit adapter and optional AI | Separate TS/Python SDK processes, alternate provider, adapter and model-neutral HTTP inference fixture. Local Makora Penpot checked as a legacy connector. No live model configured. |
| MMP-R14 | Spike includes concurrency, latency, correlation, deadline and security evidence | Reproduction commands, pinned versions, 7 tests and the Go decision in [Spike](spike/README.md). |
| MMP-R15 | Compatibility matrix and independently versioned MCP, MMP, module and semantic contract | [Version matrix](spec/0.1.0/versioning.md) and separate npm/uv pins. Draft namespace documented. |
| MMP-R16 | Normative spec, schemas, SDK, Host, examples, conformance, CI and release documentation | README quickstart, versioned spec/schemas, SDK/Host, examples, conformance, workflow and repository documents. Fresh Windows setup and demo passed. |
| MMP-R17 | Independent acceptance, lint, types, architecture, build and tests | Release verification and architecture tests passed locally, including a clean copy. CI YAML passed actionlint. Final review by Codex per the user's direct-implementation instruction. |
