import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { contextKey, extension } from "@artemnoor/mmp";

const role = process.argv[2];
if (role !== "a" && role !== "b") throw new Error("Expected gateway fixture role a or b");
const read = name => JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8")).schema;
const task = read("task");
const report = read("report");
const id = `org.example.gateway-${role}`;
const probe = `org.example/probe-${role}`;
const operation = (capability, tool) => ({
  capability, inputContract: task.$id, outputContract: report.$id,
  tool, permissions: [], effects: "read-only", execution: "sync", idempotency: { mode: "natural" },
});
const operations = [operation(probe, "probe")];
if (role === "a") operations.push(operation("org.example/hold", "hold"));
const descriptor = {
  id, publisher: "org.example", version: "1.0.0", mmpVersion: "0.1.0",
  description: "Conformance-only Gateway context fixture",
  requires: [{
    capability: "org.example/research", inputContract: task.$id, outputContract: report.$id,
  }],
  operations,
};

serveStdio(() => {
  const server = new McpServer({ name: id, version: "1.0.0" }, {
    capabilities: { extensions: { [extension]: { descriptor } } },
  });
  server.registerTool("probe", {
    inputSchema: fromJsonSchema(task), outputSchema: fromJsonSchema(report),
  }, (_args, ctx) => {
    const context = ctx.mcpReq._meta?.[contextKey];
    return {
      content: [{ type: "text", text: `probe ${role}` }],
      structuredContent: {
        findings: [String(process.env.MMP_CREDENTIAL ?? "missing"), String(context ?? "missing")],
      },
    };
  });
  if (role === "a") {
    server.registerTool("hold", {
      inputSchema: fromJsonSchema(task), outputSchema: fromJsonSchema(report),
    }, async (args, ctx) => {
      const context = ctx.mcpReq._meta?.[contextKey];
      if (process.env.MMP_PROBE_FILE) {
        writeFileSync(process.env.MMP_PROBE_FILE, JSON.stringify({
          credential: String(process.env.MMP_CREDENTIAL ?? "missing"), context: String(context ?? "missing"),
        }));
      }
      await delay(Number(args.waitMs ?? 0), undefined, { signal: ctx.mcpReq.signal });
      return {
        content: [{ type: "text", text: "hold" }],
        structuredContent: { findings: ["hold complete"] },
      };
    });
  }
  return server;
});
