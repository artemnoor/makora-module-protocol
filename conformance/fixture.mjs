import { readFileSync } from "node:fs";
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const variant = process.argv[2];
const role = variant === "ledger-replacement" ? "ledger" : "research";
const descriptor = JSON.parse(readFileSync(new URL(`../examples/descriptors/${role}.json`, import.meta.url), "utf8"));
const getSchema = name => JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8")).schema;
const input = getSchema("task");
const output = getSchema(role === "ledger" ? "receipt" : "report");
if (variant === "ledger-replacement") descriptor.id = "org.example.alternate-ledger";
if (variant === "malformed") delete descriptor.publisher;
if (variant === "version") descriptor.mmpVersion = "0.2.0";
if (variant === "package-version") descriptor.version = "2.0.0";
if (variant === "reserved") descriptor.operations[0].tool = "mmp_invoke";
if (variant === "permission") descriptor.operations[0].permissions = ["unknown.permission"];
if (variant === "schema") input.properties.topic.maxLength = 3;
if (variant === "persistent") {
  descriptor.operations[0].idempotency = { mode: "deduplicated", retentionSeconds: 1, restartPersistent: true };
}
const capabilities = variant === "unadvertised" ? {} : {
  extensions: { "org.example/mmp": { descriptor } },
};
serveStdio(() => {
  const server = new McpServer({ name: descriptor.id, version: descriptor.version }, { capabilities });
  server.registerTool(descriptor.operations[0].tool, {
    inputSchema: fromJsonSchema(input), outputSchema: fromJsonSchema(output),
  }, ({ topic }) => ({
    content: [{ type: "text", text: String(topic) }],
    structuredContent: variant === "invalid-output" ? { unexpected: topic }
      : role === "ledger" ? { sequence: 99, text: topic } : { findings: [topic] },
  }));
  return server;
});
