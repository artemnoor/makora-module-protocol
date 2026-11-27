import { equal, ok } from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createConfig, digest, fixturePackage, moduleId, query, root } from "./config.mjs";
import { errorKey } from "@artemnoor/mmp";
import { hostRejects, label, start } from "./harness.mjs";

for (const variant of [
  "unadvertised",
  "draft-extension",
  "malformed",
  "version",
  "package-version",
  "reserved",
  "permission",
  "persistent",
  "schema",
]) {
  test(label(`rejects ${variant} module at admission`), async () => {
    const config = createConfig();
    config.packages = [fixturePackage(variant)];
    await hostRejects(start(config));
  });
}

test(label("remote JSON Schema references are rejected before compilation"), async () => {
  const temp = await mkdtemp(join(tmpdir(), "mmp-contract-"));
  try {
    const definition = JSON.parse(await readFile(join(root, "contracts/task.json"), "utf8"));
    definition.schema.properties.topic = { $ref: "https://example.invalid/schemas/topic" };
    const file = join(temp, "contract.json");
    const data = JSON.stringify(definition);
    await writeFile(file, data);
    const config = createConfig();
    config.packages = [];
    config.catalog = [{ file, digest: digest(data) }];
    await hostRejects(start(config));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test(label("an invalid structured output from an admitted provider never reaches the consumer as success"), async () => {
  const config = createConfig();
  config.packages = [fixturePackage("invalid-output")];
  const host = await start(config);
  try {
    const result = await host.call("host:demo", { ...query("research", "task", "report"), arguments: { topic: "bad" } });
    equal(result.isError, true);
    equal(result.structuredContent, undefined);
    equal(result._meta[errorKey].retryable, false);
    ok(typeof result._meta[errorKey].correlationId === "string" && result._meta[errorKey].correlationId.length > 0);
  } finally {
    await host.close();
  }
});

test(label("a retained key cannot dispatch to a replacement provider"), async () => {
  const config = createConfig();
  config.packages = config.packages.filter(item => item.id === moduleId("ledger"));
  const replacement = "org.example.alternate-ledger";
  config.packages.push(fixturePackage("ledger-replacement", replacement));
  config.grants.push({
    caller: "host:demo", target: replacement, tool: "record",
    effects: "write", permissions: ["ledger.write"],
  });
  const host = await start(config);
  const triple = query("record", "task", "receipt");
  const call = { ...triple, arguments: { topic: "retained" }, idempotencyKey: "pin" };
  try {
    equal((await host.call("host:demo", call)).structuredContent.result.sequence, 1);
    await host.select(triple, replacement);
    equal((await host.call("host:demo", call))._meta[errorKey].kind, "IDEMPOTENCY_CONFLICT");
    equal((await host.call("host:demo", { ...call, idempotencyKey: "fresh" })).structuredContent.result.sequence, 99);
  } finally {
    await host.close();
  }
});

test(label("an in-flight call keeps its provider pin while another provider is selected"), async () => {
  const config = createConfig();
  config.packages = config.packages.filter(item => item.id === moduleId("ledger"));
  const replacement = "org.example.alternate-ledger";
  config.packages.push(fixturePackage("ledger-replacement", replacement));
  config.grants.push({
    caller: "host:demo", target: replacement, tool: "record",
    effects: "write", permissions: ["ledger.write"],
  });
  const host = await start(config);
  const triple = query("record", "task", "receipt");
  try {
    const pending = host.call("host:demo", {
      ...triple, arguments: { topic: "pinned", waitMs: 500 }, idempotencyKey: "inflight",
    });
    await delay(100);
    await host.select(triple, replacement);
    equal((await pending).structuredContent.result.sequence, 1);
    equal((await host.call("host:demo", {
      ...triple, arguments: { topic: "fresh" }, idempotencyKey: "fresh",
    })).structuredContent.result.sequence, 99);
  } finally {
    await host.close();
  }
});
