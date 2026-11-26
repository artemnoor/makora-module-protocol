# Module starters

Copy either directory into a new project and copy [contract.json](contract.json) into the same directory. The two starters publish the exact same echo capability and contracts.

- TypeScript. Install the local `@artemnoor/mmp` archive, run `npm install`, and run `npm run build`. The stdio entry point is `node dist/server.js`.
- Python. Run `uv sync` to initialize the standalone environment. The stdio entry point is `uv run python server.py`.

Use explicit package pins, the shared contract and caller grants to connect either server to a Host. The [developer guide](../docs/developer-guide.md) shows the programmatic configuration. `npm run verify:external` compiles the TypeScript template against the installed tarball, exercises both templates over stdio and verifies replacement.
