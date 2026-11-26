# Contributing

Start with the affected requirement in REQUIREMENTS.md. Add positive and negative fixtures for contract changes and a black-box scenario for behavior changes. Use stable published IDs for unchanged contracts. For an incompatible contract, create a new ID and include an explicit adapter when a migration needs one.

Run `npm run verify:release` and the Spike before asking for review. Run `npm run verify:external` for changes to package exports, the wire profile or the developer templates. Describe exact commands and evidence. Keep MCP types and transports upstream. Keep dependency, binding and scheduling choices outside the SDK protocol surface.

Use the [developer guide](docs/developer-guide.md) for public interfaces and the [release checklist](docs/release-0.1.0.md) for changes to a candidate distribution. Update the English and Russian guides together when a developer-facing workflow changes.
