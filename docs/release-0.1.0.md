# MMP 0.1.0 release candidate

[Developer guide](developer-guide.md) · [Руководство на русском](developer-guide.ru.md) · [Changelog](../CHANGELOG.md)

## Distribution and migration

Local archive verification passed with a strict TypeScript build, all four exported schemas and an SDK module invoked in a clean project. The public registry still returns `404` for `@artemnoor/mmp@0.1.0`. The publish attempt returned `E403` because the npm owner account requires two-factor authentication for publishing. Registry installation and the same consumer smoke test follow successful publication.

The wire profile uses MCP 2026-07-28 and the extension identifier `io.github.artemnoor/mmp`. The same prefix is used for context, protected-tool grant and error metadata. The authenticated GitHub account `artemnoor` was verified as owner and administrator of the canonical repository. GitHub assigns `<owner>.github.io` to that account's Pages namespace. The protocol uses the corresponding reverse-DNS name, without claiming a separately registered domain or activating a Pages site. [GitHub Pages naming](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#types-of-github-pages-sites) · [MCP metadata rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#general-fields)

Draft modules using `org.example/mmp` must update their extension and MMP metadata keys. Application capability and contract identifiers remain unchanged. The TypeScript distribution is `@artemnoor/mmp@0.1.0`; the tarball carries the public SDK, Reference Host, JSON Schemas, templates and guides. Python providers can use the official Python MCP SDK. Package: [@artemnoor/mmp](https://www.npmjs.com/package/@artemnoor/mmp). Publication procedure: publish the prepared tarball with `npm publish`, then tag the release and publish the GitHub release as separate operator steps. This record does not assert registry availability.

## Findings and changes

| Finding | Resolution |
| --- | --- |
| SDK modules depended on the checkout layout for installation. | Package exports and a pack allowlist ship the runtime, declarations and schemas. Fresh external verification exercises only those exports. |
| The loopback Gateway lacked Streamable HTTP Origin validation. | Reject a different authority or an invalid Origin before authentication. The black-box test verifies the 403 response. |
| An independently authored module could not infer the Reference Host's Gateway environment variable. | Documented the launch variables, wire metadata and protected-tool grant. The external module was corrected to use `MMP_GATEWAY`. |
| The previous error wording conflated two MCP connections. | The specification now explains downstream transport or protocol failure reporting on the original caller's valid Gateway request. |
| Independently supplied schema discovery needed an explicit identity check in the Python fixture. | The provider now checks the schema's own `$id` and object type before serving its descriptor. |

### Specification ambiguity review (this round)

An independent public-only review found places where the specification relied on Reference Host behavior without stating it. The resolution is documentation-only: no schema, wire or executable change, and no new 0.1 feature.

| Ambiguity | Resolution |
| --- | --- |
| Admission pin matching, local provenance, failed admission and exhaustive `tools/list` were implied but not stated. | [Descriptor](../spec/0.1.0/descriptor.md) now requires exact pin match for `id`, `publisher` and `version`, local artifact digest/path verification, admission failure that never registers a module, bounded cursor exhaustion, duplicate/cursor rejection and one-to-one descriptor/tool/schema binding. Alternate-transport admission keeps its own trust boundary. |
| The portable local launch binding existed only in the developer guide and SDK/example code. | [Module calls](../spec/0.1.0/module-calls.md) now defines `MMP_GATEWAY` (actual deployment-selected loopback MCP URL), `MMP_CREDENTIAL` (module-specific HTTP Bearer token) and `MMP_HOST_GRANT` (distinct protected-operation grant), their non-interchangeability and the mutual-configuration rule for alternate deployments. |
| Discovery extension metadata could be conflated with per-call MCP metadata. | [MCP profile](../spec/0.1.0/mcp-profile.md) separates `capabilities.extensions` descriptor state from base `_meta` context, grant and error fields and confirms that 0.1 adds no client opt-in. |
| Deduplication text mixed lookup scope with the pinned target and left the missing-key case and non-deduplicated modes unstated. | [Execution](../spec/0.1.0/execution.md) now defines the lookup key as authenticated caller + exact triple + key, stores canonical arguments and provider ID/version/tool, requires the key for `deduplicated`, returns `IDEMPOTENCY_CONFLICT` for a missing key, retains replacement conflicts while the record lives, and preserves JSON equality and existing lifetimes. |
| Error authority across HTTP rejection, pre-dispatch rejection, downstream provider errors and invalid output was only partial. | [Execution](../spec/0.1.0/execution.md) now separates HTTP status from MMP errors, assigns pre-dispatch failures `not-started`, reissues a valid provider error kind/outcome with the Host correlation ID, maps unclassified downstream or transport failures to `INTERNAL`/`unknown` unless deadline or cancellation applies, and marks invalid dispatched output `CONTRACT_MISMATCH`/`unknown`. It states that MMP adds no retry or coercion rule. |
| Trusted schema equality and graph-policy ownership needed explicit boundaries. | [Contracts](../spec/0.1.0/contracts.md) now states exact structural equality with object-key order ignored and array order, types and constraints significant. [Overview](../spec/0.1.0/overview.md) assigns single-call admission, policy, routing and execution to the Host and graph policy to the application. |

### Verification evidence

Assembled release result, recorded once. Sources: `verify:hosts`, `verify:external:hosts`, and the [Python Host README](../python-host/README.md).

| Suite | Evidence | Result |
| --- | --- | --- |
| `verify:hosts` | Windows bridge 1; TypeScript 34 (33 common plus TS diagnostic); Python 33 on the same common cases | Passed; 0 failures, 0 skips |
| `verify:external:hosts` | Both languages; both nested directions; four shared JSON graphs (parallel, linear, assisted, optional-inference); two branch outcomes; user resume; provider replacement; both starter providers and the original Python module; no AI in baseline; 1 controlled inference per Host | Passed |
| `verify:release` | Assembly project checks | 37 passed |
| Spike | Transport checks | 7 passed |
| Universality | Lab checks | 14 passed |
| Python clean-room | Native Python 3.12 `integration.py`: 47 checks, including capacity, retained keys and launch-pin guards | Passed |
| Linux Docker common suites | Both Host common suites in CPython 3.12 / Node 22 | Passed |

| Module configuration | TypeScript Reference Host | Independent Python Host |
| --- | --- | --- |
| Existing and starter TypeScript modules | Passed | Passed |
| Existing and independent Python modules | Passed | Passed |
| Mixed Node/TypeScript and Python chains, in both directions | Passed | Passed |
| Identical JSON graphs with sequential and parallel calls, branching, supplier replacement, and operator continuation | Passed | Passed |

### Optional AI validation

Separate from the matrix. The verified external baseline used no AI; the optional-inference graph allowed one controlled inference per Host. The prior TypeScript live baseline passed with GPT-4.1 mini selecting the MMP dispatch operation and Gemini 2.5 Flash returning the analysis branch and the continuation selected by the user.

### Final guard

The focused security changes passed. Native clean-room Python 3.12 `integration.py` produced 47 checks, including capacity, retained keys and launch-pin guards. Both Host common suites also passed in Linux Docker with CPython 3.12 and Node 22.

## Prior independent implementation

A prior independent run created the Node classifier and Python classifier/annotator in a directory outside the source repository. They used the public MCP/MMP interfaces and a shared measurement contract. The providers and [reproduction driver](../experiments/release/README.md) are included for repeatability. The separate integration process installed the SDK tarball, compiled the TypeScript starter, set up the pinned Python environment, and used both template modules over stdio.

The graphs exercised sequential calls, changing order, concurrent branches and merge, conditional skipping, a checkpoint resumed by operator input, an optional inference operation, a nested Node-to-Python annotation and Python substitution for the Node classifier. An explicit adapter converted the measurement contract to the existing Python research module's task contract. The baseline graphs performed zero inference requests; the opted-in graph performed exactly one controlled request.

The Universality Lab separately exercised the browser and live-model path. It used a sandboxed module form, ordinary MCP resources and an application-specific resume bridge. The application owns workflow state and expiration. The experimental JSON graph format and the Lab are outside the protocol.

## Licensing and scope

The SDK tarball contains project code and documentation under Apache-2.0. It declares dependencies and ships no vendored dependency binaries. Checked installed npm package metadata and a production CycloneDX inventory. The runtime libraries declare Apache-2.0, MIT, BSD-3-Clause or ISC. MCP packages carry their upstream license files and notices. Python runtime metadata included MIT/MIT-0, BSD-3-Clause, Apache-2.0, PSF-2.0 and the vendor's Python Software Foundation declaration for pywin32. The toolchain includes the MPL-2.0 development dependency pathspec, which is outside the SDK distribution. Preserve the upstream notices if redistributing dependency files.

The reference environment runs trusted local artifacts. OS-level isolation for untrusted providers, durable deduplication, process recovery and a general-purpose MCP Apps host are deployment or application concerns. Conformance evidence covers the documented 0.1 behavior and the tested examples.

## Verify before publishing

```sh
npm ci
uv sync --locked
uv sync --locked --project python-host --python 3.12
npm run verify:hosts
npm run verify:external:hosts
uv sync --locked --project demos/universality/third-party
npx playwright install chromium
npm run verify:universality
```

Host checks use `verify:hosts` and `verify:external:hosts`; the Python Host API and run instructions are in the [Python Host README](../python-host/README.md). Run the standalone [Spike](../spike/README.md) separately. The optional live-model command requires an authorized model endpoint and credentials and is not a publication gate. Use synthetic data and keep the credentials in the operator environment. Build two tarballs from the same locked sources and compare SHA-256 to check archive reproducibility.
