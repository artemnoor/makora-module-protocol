import { startHost } from "../dist/reference/host/index.js";
import { createConfig, moduleId, query } from "./config.mjs";

const events = [];
const host = await startHost(createConfig(event => events.push(event)));
try {
  const request = { ...query("coordinate", "task", "report"), arguments: { topic: "module composition" } };
  const first = await host.call("host:demo", request);
  host.select(query("research", "task", "report"), moduleId("python"));
  const replacement = await host.call("host:demo", request);
  if (first.isError || replacement.isError) {
    throw new Error(JSON.stringify({ first, replacement }));
  }
  console.log(JSON.stringify({
    initial: first.structuredContent, replacement: replacement.structuredContent,
    calls: events.map(({ correlationId, chain, caller, target, latencyMs }) => ({
      correlationId, chain, caller, target, latencyMs: Math.round(latencyMs),
    })),
  }, null, 2));
} finally {
  await host.close();
}
