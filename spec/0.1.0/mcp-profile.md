# MCP profile

The MMP 0.1 runtime profile uses MCP 2026-07-28. Use the upstream transports, message envelope, discovery, tools/list, tools/call and cancellation. The Gateway MUST implement a normal MCP server on a connection initiated by the module. A Host MAY choose either stdio or Streamable HTTP for its module-side connection under its trust policy.

A module advertises `capabilities.extensions["io.github.artemnoor/mmp"].descriptor` in `server/discover`. The `io.github.artemnoor` prefix identifies the project namespace for the profile and its metadata keys. Module publishers declare their own capability namespaces. A Host MUST verify both the MCP revision and full MMP descriptor before treating a server as a provider.

For successful business calls, `structuredContent` MUST be a JSON object satisfying the declared output contract. Public read-only tools MAY be served to ordinary MCP clients under module policy. A legacy MCP tool call cannot enroll a server as an MMP provider or acquire privileged invocation metadata. Tasks and MRTR are optional MCP features outside the sync MMP profile.
