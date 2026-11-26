# MMP 0.1.0 release candidate

[Developer guide](developer-guide.md) · [Руководство на русском](developer-guide.ru.md) · [Changelog](../CHANGELOG.md)

## Distribution and migration

The wire profile uses MCP 2026-07-28 and the extension identifier `io.github.artemnoor/mmp`. The same prefix is used for context, protected-tool grant and error metadata. The authenticated GitHub account `artemnoor` was verified as owner and administrator of the canonical repository. GitHub assigns `<owner>.github.io` to that account's Pages namespace. The protocol uses the corresponding reverse-DNS name, without claiming a separately registered domain or activating a Pages site. [GitHub Pages naming](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#types-of-github-pages-sites) · [MCP metadata rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#general-fields)

Draft modules using `org.example/mmp` must update their extension and MMP metadata keys. Application capability and contract identifiers remain unchanged. The TypeScript distribution is `@artemnoor/mmp@0.1.0`; the tarball carries the public SDK, Reference Host, JSON Schemas, templates and guides. Python providers can use the official Python MCP SDK. The candidate can be installed from its tarball. Registry publication, release tagging and GitHub publication require a separate operator action.

## Findings and changes

| Finding | Resolution |
| --- | --- |
| SDK modules depended on the checkout layout for installation. | Package exports and a pack allowlist ship the runtime, declarations and schemas. Fresh external verification exercises only those exports. |
| The loopback Gateway lacked Streamable HTTP Origin validation. | Reject a different authority or an invalid Origin before authentication. The black-box test verifies the 403 response. |
| An independently authored module could not infer the Reference Host's Gateway environment variable. | Documented the launch variables, wire metadata and protected-tool grant. The external module was corrected to use `MMP_GATEWAY`. |
| The previous error wording conflated two MCP connections. | The specification now explains downstream transport or protocol failure reporting on the original caller's valid Gateway request. |
| Independently supplied schema discovery needed an explicit identity check in the Python fixture. | The provider now checks the schema's own `$id` and object type before serving its descriptor. |

## Independent implementation

Two GPT-6 Luna High agents independently created a Node classifier and a Python classifier/annotator in a directory outside the source repository. They used the public MCP/MMP interfaces and a shared measurement contract. The providers and [reproduction driver](../experiments/release/README.md) are included for repeatability. The separate integration process installed the SDK tarball, compiled the TypeScript starter, set up the pinned Python environment, and used both template modules over stdio.

The graphs exercised sequential calls, changing order, concurrent branches and merge, conditional skipping, a checkpoint resumed by operator input, an optional inference operation, a nested Node-to-Python annotation and Python substitution for the Node classifier. An explicit adapter converted the measurement contract to the existing Python research module's task contract. The baseline graphs performed zero inference requests; the opted-in graph performed exactly one controlled request.

The Universality Lab separately exercised the browser and live-model path. It used a sandboxed module form, ordinary MCP resources and an application-specific resume bridge. The application owns workflow state and expiration. The experimental JSON graph format and the Lab are outside the protocol.

## Licensing and scope

The SDK tarball contains project code and documentation under Apache-2.0. It declares dependencies and ships no vendored dependency binaries. Checked installed npm package metadata and a production CycloneDX inventory. The runtime libraries declare Apache-2.0, MIT, BSD-3-Clause or ISC. MCP packages carry their upstream license files and notices. Python runtime metadata included MIT/MIT-0, BSD-3-Clause, Apache-2.0, PSF-2.0 and the vendor's Python Software Foundation declaration for pywin32. The toolchain includes the MPL-2.0 development dependency pathspec, which is outside the SDK distribution. Preserve the upstream notices if redistributing dependency files.

The reference environment runs trusted local artifacts. OS-level isolation for untrusted providers, durable deduplication, process recovery and a general-purpose MCP Apps host are deployment or application concerns. Conformance evidence covers the documented 0.1 behavior and the tested examples.

## Verify before publishing

```sh
npm ci
uv sync --locked
npm run verify:release
npm run verify:external
uv sync --locked --project demos/universality/third-party
npx playwright install chromium
npm run verify:universality
npm run verify:universality:live
```

Run the standalone [Spike](../spike/README.md) as well. The live command requires an authorized model endpoint and credentials. Use synthetic data and keep the credentials in the operator environment. Build two tarballs from the same locked sources and compare SHA-256 to check archive reproducibility.

## Verification record

| Check | Result |
| --- | --- |
| Reference Host conformance and architecture | 24 passed, 0 failed, 0 skipped. Includes rejection of the draft extension and the Gateway Origin check. |
| Universality Lab | 14 passed, including 6 Chromium tests. |
| Transport Spike | 7 passed. |
| External release experiment | Passed four graph configurations, both conditional outcomes, nested dispatch, provider substitution, schema import and both starter modules. |
| Authorized live models | GPT-4.1 mini selected the MMP dispatch operation. Gemini 2.5 Flash returned results for the analysis branch and for the continuation selected by the user. |
| Clean Windows installation | Installed locked npm and uv dependencies outside the checkout. Built and tested the Host, independent providers and browser Lab. |
| Independent Python distribution | Built wheel and source archive. Installed the wheel and imported its public module in a fresh Python 3.12 environment. |
| Project checks | TypeScript, mypy, ESLint, Ruff, GitHub workflow validation and documentation link checks passed. |

The release checks cover the stated 0.1 scope. Local artifacts are ready for release review and publication by the owner.
