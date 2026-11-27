import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { createConfig, moduleId, query, root } from "./config.mjs";
import { errorKey } from "@artemnoor/mmp";
import { hostRejects, label, start } from "./harness.mjs";

let host;
const caller = "host:demo";
const task = (capability, topic, waitMs) => ({
  ...query(capability, "task", capability.startsWith("record") ? "receipt" : "report"),
  arguments: waitMs === undefined ? { topic } : { topic, waitMs },
});
const invokeRecord = (key, args) => ({ ...task("record", args.topic, args.waitMs), idempotencyKey: key });
const content = result => {
  ok(result.isError === undefined || result.isError === false, JSON.stringify(result));
  return result.structuredContent.result;
};
const error = (value, kind, outcome = "not-started") => {
  equal(value.isError, true, JSON.stringify(value));
  equal(value.structuredContent, undefined);
  const meta = value._meta?.[errorKey];
  ok(meta, JSON.stringify(value));
  equal(meta.kind, kind);
  equal(meta.outcome, outcome);
  equal(typeof meta.retryable, "boolean");
  equal(typeof meta.message, "string");
  ok(meta.message.length > 0);
  ok(typeof meta.correlationId === "string" && meta.correlationId.length > 0);
  equal(Array.isArray(value.content), true);
  equal(typeof value.content[0]?.text, "string");
  ok(value.content[0].text.length > 0);
};

before(async () => { host = await start(createConfig()); });
after(async () => { await host?.close(); });

test(label("real cross-language graph and replacement run through the same consumer"), async () => {
  const initial = content(await host.call(caller, task("coordinate", "contract mesh")));
  deepEqual(initial.findings, ["reviewed contract mesh", "typescript: contract mesh", "secondary via python: contract mesh"]);
  await host.select(query("research", "task", "report"), moduleId("python"));
  try {
    const replacement = content(await host.call(caller, task("coordinate", "contract mesh")));
    deepEqual(replacement.findings, ["reviewed contract mesh", "research via python: contract mesh", "secondary via python: contract mesh"]);
  } finally {
    await host.select(query("research", "task", "report"), moduleId("research"));
  }
});

test(label("default deny and invalid business data"), async () => {
  error(await host.call("host:unknown", task("coordinate", "blocked")), "PERMISSION_DENIED");
  error(await host.call(moduleId("coordinator"), task("coordinate", "blocked")), "PERMISSION_DENIED");
  error(await host.call(caller, task("coordinate", 3)), "CONTRACT_MISMATCH");
  const response = await fetch(host.gateway, { method: "POST", body: "{}" });
  equal(response.status, 401);
  const disallowed = await fetch(host.gateway, {
    method: "POST", headers: { origin: "https://example.invalid" }, body: "{}",
  });
  equal(disallowed.status, 403);
});

test(label("missing capability and exact contract mismatch"), async () => {
  error(await host.call(caller, task("absent", "test")), "DEPENDENCY_UNAVAILABLE");
  const conversion = query("amount.convert", "amount-rub-major", "amount-rub-minor");
  const acceptance = query("amount.accept", "amount-rub-minor", "amount-rub-minor");
  const rubles = { amount: 3, currency: "RUB", unit: "major" };
  error(await host.call(caller, { ...acceptance, arguments: rubles }), "CONTRACT_MISMATCH");
  const converted = content(await host.call(caller, { ...conversion, arguments: rubles }));
  deepEqual(converted, { amount: 300, currency: "RUB", unit: "minor" });
  deepEqual(content(await host.call(caller, { ...acceptance, arguments: converted })), converted);
  await rejects(host.select(query("amount.accept", "amount-rub-major", "amount-rub-minor"), moduleId("adapter")));
});

test(label("cycles are rejected and deadline/cancellation stop active work"), async () => {
  error(await host.call(caller, task("cycle", "cycle")), "CYCLE_DETECTED");
  const deadline = Date.now() + 500;
  error(await host.call(caller, task("coordinate", "short", 2000), { deadline }), "DEADLINE_EXCEEDED", "unknown");
  const abort = new AbortController();
  const cancellation = host.call(caller, task("coordinate", "cancel", 2000), { signal: abort.signal });
  await delay(100);
  abort.abort();
  error(await cancellation, "CANCELLED", "unknown");
});

test(label("maximum depth is enforced"), async () => {
  const limited = await start(createConfig({ maxDepth: 2 }));
  try {
    error(await limited.call(caller, task("coordinate", "depth")), "MAX_DEPTH_EXCEEDED");
  } finally {
    await limited.close();
  }
});

test(label("unrelated sibling calls overlap"), async () => {
  const started = performance.now();
  const [left, right] = await Promise.all([
    host.call(caller, task("research", "overlap-left", 400)),
    host.call(caller, task("research", "overlap-right", 400)),
  ]);
  const elapsed = performance.now() - started;
  deepEqual(content(left).findings, ["typescript: overlap-left"]);
  deepEqual(content(right).findings, ["typescript: overlap-right"]);
  ok(elapsed < 700, `expected overlapping work, elapsed ${elapsed.toFixed(0)}ms`);
});

test(label("concurrent duplicate dispatch, divergent arguments, caller scope and retention"), async () => {
  const args = { topic: "same value", waitMs: 150 };
  const request = invokeRecord("concurrent", args);
  const [first, second] = await Promise.all([host.call(caller, request), host.call(caller, request)]);
  const receipt = content(first);
  deepEqual(content(second), receipt);
  deepEqual(content(await host.call(caller, request)), receipt);
  deepEqual(content(await host.call(caller, invokeRecord("concurrent", { waitMs: args.waitMs, topic: args.topic }))), receipt);
  error(await host.call(caller, invokeRecord("concurrent", { ...args, topic: "changed" })), "IDEMPOTENCY_CONFLICT");
  error(await host.call(caller, task("record", args.topic)), "IDEMPOTENCY_CONFLICT");
  const copy = content(await host.call("host:secondary", request));
  equal(copy.sequence, receipt.sequence + 1);
  await delay(1100);
  const expired = content(await host.call(caller, request));
  equal(expired.sequence, copy.sequence + 1);
});

test(label("nested Gateway uses the same deduplication contract"), async () => {
  const request = task("record-nested", "gateway-key");
  const [one, two] = await Promise.all([host.call(caller, request), host.call(caller, request)]);
  deepEqual(content(one), content(two));
});

test(label("ordinary legacy MCP client sees business tools and protected calls remain denied"), async () => {
  const client = new Client({ name: "ordinary-mcp-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["dist/examples/module.js", "research"], cwd: root,
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "research", arguments: { topic: "legacy" } });
    deepEqual(result.structuredContent, { findings: ["typescript: legacy"] });
  } finally {
    await client.close();
  }
  const ledger = new Client({ name: "ordinary-mcp-test", version: "1.0.0" });
  await ledger.connect(new StdioClientTransport({
    command: process.execPath, args: ["dist/examples/module.js", "ledger"], cwd: root,
  }));
  try {
    const direct = await ledger.callTool({ name: "record", arguments: { topic: "direct" } });
    equal(direct.isError, true);
    equal(direct._meta[errorKey].kind, "PERMISSION_DENIED");
  } finally {
    await ledger.close();
  }
});

test(label("trusted schema and package digests are checked"), async () => {
  const contractConfig = createConfig();
  contractConfig.catalog = [{ file: join(root, "contracts/task.json"), digest: "0".repeat(64) }];
  await hostRejects(start(contractConfig));
  const packageConfig = createConfig();
  packageConfig.packages = packageConfig.packages.filter(item => item.id === moduleId("research"));
  packageConfig.packages[0].files["dist/examples/module.js"] = "0".repeat(64);
  await hostRejects(start(packageConfig));
});

test(label("restart guarantee is explicitly process-local"), async () => {
  const options = createConfig();
  options.packages = options.packages.filter(item => item.id === moduleId("ledger"));
  const key = invokeRecord("restart", { topic: "before restart" });
  const beforeRestart = await start(options);
  try {
    equal(content(await beforeRestart.call(caller, key)).sequence, 1);
    error(await beforeRestart.call(caller, invokeRecord("restart", { topic: "changed" })), "IDEMPOTENCY_CONFLICT");
  } finally {
    await beforeRestart.close();
  }
  const restarted = await start(options);
  try {
    equal(content(await restarted.call(caller, invokeRecord("restart", { topic: "changed" }))).sequence, 1);
  } finally {
    await restarted.close();
  }
});
