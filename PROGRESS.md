# Progress

2026-11-26: Reviewed the R2 development guide and confirmed MCP 2026-07-28 support in the official TypeScript 2.4.0 and Python 2.3.0 SDK releases.

MMP-00 through MMP-04 are implemented. Spike confirmed MCP 2026-07-28 stdio and Streamable HTTP, modern descriptor discovery, real TS/Python nested calls, branching, identity binding and handler cancellation. The reference implementation and draft standard are in the source checkout.

The installed Makora Penpot bridge was queried with an ordinary MCP client. It negotiated 2025-06-18 and returned four tools. The bridge advertises no MMP extension. No design change was made. The model-neutral research endpoint passed its controlled HTTP fixture over a real MCP call. There was no configured live inference endpoint in the acceptance environment.

## Final acceptance

Fresh source copies passed on Windows and Ubuntu with Node 22.13.0 and Python 3.12. Windows also passed the final release verification in the working checkout. The source inventories excluded installed dependencies, virtual environments and compiled output.

| Check | Result |
| --- | --- |
| `npm ci` and `uv sync --locked --python 3.12` | Both clean installs passed |
| `npm run verify:release` | Both passed ESLint, Ruff, import graph and filesystem checks, TypeScript and mypy, build and main tests |
| Main test totals | 23 passed, 0 failed, 0 skipped per platform, including the two architecture tests |
| `node examples/demo.mjs` | Both completed the initial and replacement scenarios |
| `npm ci`, `uv sync --locked --python 3.12`, `npm run check` in `spike/` | 7 passed, 0 failed, 0 skipped per platform |
| `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/verify.yml` | Workflow validation passed |
| `npm audit --audit-level=moderate` | 0 reported vulnerabilities |

The final review covered package and schema trust, default deny, branch-scoped cancellation, provider pins, retained outcomes and the tests behind these behaviors. Earlier independent research covered upstream API compatibility and the R2 requirements matrix.

Local MMP 0.1 draft acceptance is complete. See the repository's Actions tab for hosted CI results. The stable namespace and release tag are separate release actions. The Apache-2.0 text covers this repository. Upstream SDKs are installed as dependencies. The upstream sample smoke runs used scratch copies.
