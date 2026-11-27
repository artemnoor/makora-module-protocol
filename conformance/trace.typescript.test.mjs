import { ok } from "node:assert/strict";
import { test } from "node:test";
import { startHost } from "@artemnoor/mmp/host";
import { createConfig, moduleId, query } from "./config.mjs";

test("TypeScript Host trace records nested cross-language edges", async () => {
  const trace = [];
  const host = await startHost(createConfig(event => trace.push(event)));
  try {
    await host.call("host:demo", { ...query("coordinate", "task", "report"), arguments: { topic: "trace" } });
  } finally {
    await host.close();
  }
  ok(trace.some(event => event.caller === moduleId("planner") && event.target === moduleId("reviewer")));
  ok(trace.some(event => event.caller === moduleId("coordinator") && event.target === moduleId("python")));
});
