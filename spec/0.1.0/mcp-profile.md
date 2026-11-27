# MCP profile

The MMP 0.1 runtime profile uses MCP 2026-07-28. Use the upstream transports, message envelope, discovery, tools/list, tools/call and cancellation. The Gateway MUST implement a normal MCP server on a connection initiated by the module. A Host MAY choose either stdio or Streamable HTTP for its module-side connection under its trust policy.

A module advertises `capabilities.extensions["io.github.artemnoor/mmp"].descriptor` in `server/discover`. The `io.github.artemnoor` prefix identifies the project namespace for the profile and its metadata keys. Module publishers declare their own capability namespaces. A Host MUST verify both the MCP revision and full MMP descriptor before treating a server as a provider.

Discovery metadata and invocation metadata are distinct. The descriptor is discovery-time capability state under `capabilities.extensions`. The execution context reference and protected-tool grant are base MCP request `_meta` fields; error details are base MCP result `_meta` fields. They are not additional capabilities and require no separate client capability declaration: MMP 0.1 uses the existing MCP request and result metadata without a new opt-in.

For successful business calls, `structuredContent` MUST be a JSON object satisfying the declared output contract. Public read-only tools MAY be served to ordinary MCP clients under module policy; they are outside the provider operation set admitted from the descriptor. A legacy MCP tool call cannot enroll a server as an MMP provider or acquire privileged invocation metadata. Tasks and MRTR are optional MCP features outside the sync MMP profile.
