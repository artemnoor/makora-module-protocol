# Changelog

## 0.1.0

- Established the MCP 2026-07-28 transport profile through a TypeScript and Python Spike.
- Added descriptor discovery, trusted contracts, exact routing, execution context, default-deny policy and scoped deduplication.
- Added Reference Host, TypeScript SDK, independent examples and conformance checks.
- Assigned the 0.1 wire namespace `io.github.artemnoor`. Update draft servers and Gateway metadata from `org.example/mmp*` to the release keys.
- Added installable SDK and Reference Host exports, TypeScript and Python templates, bilingual developer documentation and an independent release experiment.
- Added loopback authority and Origin checks to the Gateway and clarified how downstream MCP failures surface on the caller's connection.
- Clarified admission pin matching, local artifact provenance, failed-admission isolation, exhaustive `tools/list` pagination and one-to-one descriptor/tool/schema binding in the 0.1 specification.
- Documented the portable local launch binding `MMP_GATEWAY`, `MMP_CREDENTIAL` and `MMP_HOST_GRANT`, and separated discovery extension metadata from per-call base MCP `_meta` fields.
- Clarified deduplication lookup by authenticated caller, exact triple and key; stored canonical arguments and pinned provider ID/version/tool; required key for `deduplicated`; replacement conflicts during retention; and JSON value equality.
- Clarified authority and outcome for HTTP rejection, pre-dispatch rejection, downstream provider errors and invalid output, without adding retry or argument-coercion rules.
- Recorded assembled Windows evidence: `verify:hosts` passed bridge 1 with TypeScript 34 and Python 33 on the same common cases and zero failures or skips; `verify:external:hosts` passed both languages, both nested directions and four shared graphs; `verify:release` reported 37 checks; Spike 7 and Universality 14 passed.
- Optional AI remains separate: the baseline used no AI and the optional graph allowed one controlled inference per Host; the prior TypeScript live baseline passed. The exact tarball is prepared for publication.
- Final guard passed: native clean-room Python 3.12 `integration.py` reported 47 checks, including capacity, retained keys and launch-pin guards; both Host common suites also passed in Linux Docker with CPython 3.12 and Node 22.
