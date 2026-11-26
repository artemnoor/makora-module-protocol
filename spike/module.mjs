import { setTimeout } from "node:timers/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import { callContext, connect, extension, failure, gatewayTransport, report, structured, task } from "./mcp.mjs";

const id = process.env.MMP_MODULE;
const credential = process.env.MMP_CREDENTIAL;
const url = process.env.MMP_GATEWAY;
const input = z.strictObject({ topic: z.string(), waitMs: z.number().int().nonnegative().optional() });
const output = z.object({ findings: z.array(z.string()) });

async function invoke(capability, args, context) {
  const client = await connect(gatewayTransport(url, credential));
  try {
    return await client.callTool({
      name: "mmp_invoke",
      arguments: { capability, inputContract: task, outputContract: report, arguments: args },
      _meta: { [callContext]: context._meta?.[callContext] },
    }, { signal: context.signal });
  } finally {
    await client.close();
  }
}

const server = new McpServer({ name: id, version: "1.0.0" }, {
  capabilities: { extensions: { [extension]: { descriptor: { id, mmpVersion: "0.1.0" } } } },
});
server.registerTool("report", { inputSchema: input, outputSchema: output }, async (args, ctx) => {
  if (args.waitMs) await setTimeout(args.waitMs, undefined, { signal: ctx.mcpReq.signal });
  return structured({ findings: [`${id}:${args.topic}`] });
});
server.registerTool("protected", { inputSchema: input, outputSchema: output }, async (args, ctx) => {
  if (ctx.mcpReq._meta?.["io.github.artemnoor/mmp-grant"] !== process.env.MMP_HOST_GRANT || !process.env.MMP_HOST_GRANT) {
    return failure("PERMISSION_DENIED", "unavailable");
  }
  return structured({ findings: [args.topic] });
});
server.registerTool("branch", { inputSchema: input, outputSchema: output }, async (args, ctx) => {
  const results = await Promise.all([
    invoke("org.example/research", args, ctx.mcpReq),
    invoke("org.example/research", args, ctx.mcpReq),
  ]);
  const failed = results.find(result => result.isError);
  if (failed) return failed;
  return structured({ findings: results.flatMap(result => result.structuredContent.result.findings) });
});
server.registerTool("delegate", {
  inputSchema: input.extend({ capability: z.string() }),
  outputSchema: output,
}, async ({ capability, ...args }, ctx) => {
  const result = await invoke(capability, args, ctx.mcpReq);
  return result.isError ? result : structured(result.structuredContent.result);
});
await serveStdio(() => server);
