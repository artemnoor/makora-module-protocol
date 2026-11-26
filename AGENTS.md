# MMP repository

- Treat `spec/` and `schemas/` as the public protocol boundary. Keep both in sync and extend conformance when behavior changes.
- The TypeScript SDK owns the MCP binding. The Reference Host owns admission, policy, routing and execution state. Example modules use the public SDK or official Python MCP SDK. Keep graph decisions in the example application.
- Run `npm run verify:release` and `npm run check` from `spike/` after changing the MCP wire path. Use locked installs for both environments.
- Verify package and contract digests when reviewing changes to `examples/pins.json`. An incompatible contract requires a new versioned ID.
