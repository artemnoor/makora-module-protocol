import { readFileSync } from "node:fs";
import { createModule, structured, type Descriptor, type JsonObject } from "@artemnoor/mmp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const schema = JSON.parse(readFileSync(new URL("../contract.json", import.meta.url), "utf8")).schema as JsonObject;
const contract = String(schema.$id);

const descriptor: Descriptor = {
  id: "org.example.typescript-echo", publisher: "org.example", version: "1.0.0", mmpVersion: "0.1.0",
  description: "Return a message unchanged",
  requires: [],
  operations: [{
    capability: "org.example/echo", inputContract: contract, outputContract: contract,
    tool: "echo", effects: "read-only", permissions: [], execution: "sync", idempotency: { mode: "natural" },
  }],
};
serveStdio(() => createModule(descriptor, {
  echo: { inputSchema: schema, outputSchema: schema, run: input => structured(input) },
}, {
  gateway: process.env.MMP_GATEWAY, credential: process.env.MMP_CREDENTIAL, hostGrant: process.env.MMP_HOST_GRANT,
}));
