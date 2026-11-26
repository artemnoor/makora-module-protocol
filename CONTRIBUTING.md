# Contributing

Start with the affected requirement in REQUIREMENTS.md. Add positive and negative fixtures for contract changes and a black-box scenario for behavior changes. Use stable published IDs for unchanged contracts. For an incompatible contract, create a new ID and include an explicit adapter when a migration needs one.

Run `npm run verify:release` and the Spike before asking for review. Provide exact commands and evidence. Keep MCP types and transports upstream. Keep dependency, binding and scheduling choices outside the SDK protocol surface.
