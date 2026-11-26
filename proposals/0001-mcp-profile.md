# RFC 0001. MCP profile for MMP 0.1

Adopt MCP 2026-07-28 after the transport Spike. Use full descriptor settings from server/discover, one separate Gateway MCP call, and an opaque Host-owned context reference. Use a namespaced output metadata entry for errors, with scoped idempotency keys in mmp_invoke. The local Reference Host declares process-local deduplication. Use the draft example namespace until a naming authority confirms the stable namespace.

The Spike verified all core transport paths with the official TypeScript and Python SDKs and independent processes. See [the report](../spike/README.md).
