import { deepEqual, equal, ok } from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import { callContext, connect, extension, gatewayTransport, operationError, report, revision, task } from "./mcp.mjs";
import { startHost } from "./host.mjs";

let host;
before(async () => { host = await startHost(); });
after(async () => { await host?.close(); });

function checkFailure(result, kind, outcome = "not-started") {
  equal(result.isError, true);
  equal(result._meta[operationError].kind, kind);
  equal(result._meta[operationError].outcome, outcome);
}

async function until(predicate) {
  const end = performance.now() + 1500;
  while (!predicate()) {
    if (performance.now() >= end) throw new Error("Expected event did not arrive");
    await delay(10);
  }
}

test("modern discovery advertises both module extensions and structured schemas", async () => {
  for (const id of ["typescript", "python"]) {
    const client = host.processes.get(id);
    equal(client.getNegotiatedProtocolVersion(), revision);
    const discovery = await client.discover();
    equal(discovery.capabilities.extensions[extension].descriptor.id, id);
    const listed = (await client.listTools()).tools.find(tool => tool.name === "report");
    equal(listed.inputSchema.type, "object");
    equal(listed.outputSchema.type, "object");
    const result = await client.callTool({ name: "report", arguments: { topic: "public" } });
    deepEqual(result.structuredContent.findings, [`${id}:public`]);
  }
});

test("both module languages make nested Gateway calls", async () => {
  const cross = [["typescript", "research", "python"], ["python", "report", "typescript"]];
  for (const [caller, cap, target] of cross) {
    const result = await host.call(caller, "delegate", { capability: `org.example/${cap}`, topic: "nested" });
    deepEqual(result.structuredContent?.findings, [`${target}:nested`], JSON.stringify(result));
  }
});

test("overlapping sibling calls join and the consumer accepts a replacement", async () => {
  const args = { topic: "join", waitMs: 150 };
  const offset = host.trace.length;
  const initial = await host.call("typescript", "branch", args);
  deepEqual(initial.structuredContent?.findings, ["python:join", "python:join"], JSON.stringify(initial));
  const events = host.trace.slice(offset);
  deepEqual(events.map(event => event.phase), ["start", "start", "finish", "finish"]);
  equal(new Set(events.map(event => event.correlationId)).size, 1);
  ok(events.filter(event => event.phase === "finish").every(event => event.latencyMs >= 100));
  host.route("org.example/research", "alternate", "report");
  try {
    const replacement = await host.call("typescript", "branch", args);
    deepEqual(replacement.structuredContent?.findings, ["alternate:join", "alternate:join"]);
  } finally {
    host.route("org.example/research", "python", "report");
  }
});

test("active cycles and depth limits reject before routing", async () => {
  const cyclic = await host.call("typescript", "delegate",
    { topic: "cycle", capability: "org.example/reenter" }, { capability: "org.example/reenter" });
  checkFailure(cyclic, "CYCLE_DETECTED");
  host.setDepth(1);
  try {
    const deep = await host.call("typescript", "delegate", { topic: "depth", capability: "org.example/research" });
    checkFailure(deep, "MAX_DEPTH_EXCEEDED");
  } finally {
    host.setDepth(4);
  }
});

test("default deny covers undeclared dependencies and protected direct calls", async () => {
  const denied = await host.call("typescript", "delegate", { topic: "denied", capability: "org.example/protected" });
  checkFailure(denied, "PERMISSION_DENIED");
  const direct = await host.processes.get("typescript").callTool({ name: "protected", arguments: { topic: "direct" } });
  checkFailure(direct, "PERMISSION_DENIED");
  const pending = host.call("typescript", "delegate",
    { topic: "active identity", capability: "org.example/research", waitMs: 400 });
  await until(() => host.activeContext("typescript") && host.activeContext("python"));
  const mismatched = host.activeContext("typescript");
  const client = await connect(gatewayTransport(host.url, host.credential("python")));
  try {
    const result = await client.callTool({
      name: "mmp_invoke",
      arguments: { capability: "org.example/report", inputContract: task, outputContract: report, arguments: { topic: "identity" } },
      _meta: { [callContext]: mismatched },
    });
    checkFailure(result, "PERMISSION_DENIED");
  } finally {
    await client.close();
    equal((await pending).isError, undefined);
  }
});

test("deadline bounds an active nested operation", async () => {
  const offset = host.trace.length;
  const result = await host.call("typescript", "delegate",
    { topic: "deadline", capability: "org.example/research", waitMs: 2000 }, { budget: 500 });
  checkFailure(result, "DEADLINE_EXCEEDED", "unknown");
  await until(() => host.trace.slice(offset).some(event => event.kind === "DEADLINE_EXCEEDED"));
});

test("cancellation reaches an active descendant", async () => {
  const abort = new AbortController();
  const offset = host.trace.length;
  const cancellations = host.cancelledHandlers.length;
  const pending = host.call("typescript", "delegate",
    { topic: "cancel", capability: "org.example/research", waitMs: 2000 }, { abort: abort.signal });
  await until(() => host.trace.slice(offset).some(event => event.phase === "start"));
  abort.abort();
  checkFailure(await pending, "CANCELLED", "unknown");
  await until(() => host.trace.slice(offset).some(event => event.kind === "CANCELLED"));
  await until(() => host.cancelledHandlers.slice(cancellations).includes("python"));
});
