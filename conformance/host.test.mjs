import { deepEqual, equal, match, ok, rejects, throws } from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { createConfig, moduleId, query, root } from "../examples/config.mjs";
import { Catalog } from "../dist/reference/host/catalog.js";
import { startHost } from "../dist/reference/host/index.js";
import { errorKey } from "../dist/sdk/typescript/index.js";

let host;
const trace = [];
const caller = "host:demo";
const task = (capability, topic, waitMs) => ({
  ...query(capability, "task", capability.startsWith("record") ? "receipt" : "report"),
  arguments: waitMs === undefined ? { topic } : { topic, waitMs },
});
const invokeRecord = (key, args) => ({ ...task("record", args.topic, args.waitMs), idempotencyKey: key });
const content = result => {
  equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent.result;
};
const error = (value, kind, outcome = "not-started") => {
  equal(value.isError, true, JSON.stringify(value));
  equal(value._meta[errorKey].kind, kind);
  equal(value._meta[errorKey].outcome, outcome);
  match(value._meta[errorKey].correlationId, /^[0-9a-f-]{36}$/);
};

before(async () => { host = await startHost(createConfig(event => trace.push(event))); });
after(async () => { await host?.close(); });

test("real cross-language graph and replacement run through the same consumer", async () => {
  const initial = content(await host.call(caller, task("coordinate", "contract mesh")));
  deepEqual(initial.findings, ["reviewed contract mesh", "typescript: contract mesh", "secondary via python: contract mesh"]);
  ok(trace.some(event => event.caller === moduleId("planner") && event.target === moduleId("reviewer")));
  host.select(query("research", "task", "report"), moduleId("python"));
  try {
    const replacement = content(await host.call(caller, task("coordinate", "contract mesh")));
    deepEqual(replacement.findings, ["reviewed contract mesh", "research via python: contract mesh", "secondary via python: contract mesh"]);
  } finally {
    host.select(query("research", "task", "report"), moduleId("research"));
  }
});

test("default deny and invalid business data", async () => {
  error(await host.call("host:unknown", task("coordinate", "blocked")), "PERMISSION_DENIED");
  error(await host.call(moduleId("coordinator"), task("coordinate", "blocked")), "PERMISSION_DENIED");
  error(await host.call(caller, task("coordinate", 3)), "CONTRACT_MISMATCH");
  const response = await fetch(host.gateway, { method: "POST", body: "{}" });
  equal(response.status, 401);
});

test("missing capability and exact contract mismatch", async () => {
  error(await host.call(caller, task("absent", "test")), "DEPENDENCY_UNAVAILABLE");
  const conversion = query("amount.convert", "amount-rub-major", "amount-rub-minor");
  const acceptance = query("amount.accept", "amount-rub-minor", "amount-rub-minor");
  const rubles = { amount: 3, currency: "RUB", unit: "major" };
  error(await host.call(caller, { ...acceptance, arguments: rubles }), "CONTRACT_MISMATCH");
  const converted = content(await host.call(caller, { ...conversion, arguments: rubles }));
  deepEqual(converted, { amount: 300, currency: "RUB", unit: "minor" });
  deepEqual(content(await host.call(caller, { ...acceptance, arguments: converted })), converted);
  throws(() => host.select(query("amount.accept", "amount-rub-major", "amount-rub-minor"), moduleId("adapter")));
});

test("cycles are rejected and deadline/cancellation stop active work", async () => {
  error(await host.call(caller, task("cycle", "cycle")), "CYCLE_DETECTED");
  const deadline = Date.now() + 500;
  error(await host.call(caller, task("coordinate", "short", 2000), { deadline }), "DEADLINE_EXCEEDED", "unknown");
  const abort = new AbortController();
  const cancellation = host.call(caller, task("coordinate", "cancel", 2000), { signal: abort.signal });
  await delay(100);
  abort.abort();
  error(await cancellation, "CANCELLED", "unknown");
});

test("concurrent duplicate dispatch, divergent arguments, caller scope and retention", async () => {
  const args = { topic: "same value", waitMs: 150 };
  const request = invokeRecord("concurrent", args);
  const [first, second] = await Promise.all([host.call(caller, request), host.call(caller, request)]);
  const receipt = content(first);
  deepEqual(content(second), receipt);
  deepEqual(content(await host.call(caller, request)), receipt);
  error(await host.call(caller, invokeRecord("concurrent", { ...args, topic: "changed" })), "IDEMPOTENCY_CONFLICT");
  error(await host.call(caller, task("record", args.topic)), "IDEMPOTENCY_CONFLICT");
  const copy = content(await host.call("host:secondary", request));
  equal(copy.sequence, receipt.sequence + 1);
  await delay(1100);
  const expired = content(await host.call(caller, request));
  equal(expired.sequence, copy.sequence + 1);
});

test("nested Gateway uses the same deduplication contract", async () => {
  const request = task("record-nested", "gateway-key");
  const [one, two] = await Promise.all([host.call(caller, request), host.call(caller, request)]);
  deepEqual(content(one), content(two));
});

test("ordinary legacy MCP client sees business tools and protected calls remain denied", async () => {
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

test("trusted schema and package digests are checked", async () => {
  throws(() => new Catalog([{ file: join(root, "contracts/task.json"), digest: "0".repeat(64) }]), /digest/);
  const config = createConfig();
  config.packages = config.packages.filter(item => item.id === moduleId("research"));
  config.packages[0].files["dist/examples/module.js"] = "0".repeat(64);
  await rejects(startHost(config), /digest/);
});

test("restart guarantee is explicitly process-local", async () => {
  const options = createConfig();
  options.packages = options.packages.filter(item => item.id === moduleId("ledger"));
  const key = invokeRecord("restart", { topic: "before restart" });
  const beforeRestart = await startHost(options);
  try {
    equal(content(await beforeRestart.call(caller, key)).sequence, 1);
    error(await beforeRestart.call(caller, invokeRecord("restart", { topic: "changed" })), "IDEMPOTENCY_CONFLICT");
  } finally {
    await beforeRestart.close();
  }
  const restarted = await startHost(options);
  try {
    equal(content(await restarted.call(caller, invokeRecord("restart", { topic: "changed" }))).sequence, 1);
  } finally {
    await restarted.close();
  }
});
