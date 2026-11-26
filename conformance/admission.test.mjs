import { equal, rejects, throws } from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createConfig, moduleId, query, root } from "../examples/config.mjs";
import { Catalog, digest } from "../dist/reference/host/catalog.js";
import { startHost } from "../dist/reference/host/index.js";
import { errorKey } from "../dist/sdk/typescript/index.js";

const fixture = "conformance/fixture.mjs";
const hash = digest(await readFile(join(root, fixture)));
for (const [variant, reason] of [
  ["unadvertised", /descriptor/],
  ["malformed", /descriptor/],
  ["version", /descriptor/],
  ["package-version", /descriptor/],
  ["reserved", /operation/],
  ["permission", /operation/],
  ["persistent", /operation/],
  ["schema", /Schema mismatch/],
]) {
  test(`rejects ${variant} module at admission`, async () => {
    const config = createConfig();
    config.packages = [{
      id: moduleId("research"), publisher: "org.example", version: "1.0.0", root,
      command: process.execPath, args: [fixture, variant], files: { [fixture]: hash },
    }];
    await rejects(startHost(config), reason);
  });
}

test("remote JSON Schema references are rejected before compilation", async () => {
  const temp = await mkdtemp(join(tmpdir(), "mmp-contract-"));
  try {
    const definition = JSON.parse(await readFile(join(root, "contracts/task.json"), "utf8"));
    definition.schema.properties.topic = { $ref: "https://example.invalid/schemas/topic" };
    const file = join(temp, "contract.json");
    const data = JSON.stringify(definition);
    await writeFile(file, data);
    throws(() => new Catalog([{ file, digest: digest(data) }]), /local fragments/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("an invalid structured output from an admitted provider never reaches the consumer as success", async () => {
  const config = createConfig();
  config.packages = [{
    id: moduleId("research"), publisher: "org.example", version: "1.0.0", root,
    command: process.execPath, args: [fixture, "invalid-output"], files: { [fixture]: hash },
  }];
  const host = await startHost(config);
  try {
    const result = await host.call("host:demo", { ...query("research", "task", "report"), arguments: { topic: "bad" } });
    equal(result.isError, true);
    equal(result.structuredContent, undefined);
  } finally {
    await host.close();
  }
});

test("a retained key cannot dispatch to a replacement provider", async () => {
  const config = createConfig();
  config.packages = config.packages.filter(item => item.id === moduleId("ledger"));
  const replacement = "org.example.alternate-ledger";
  config.packages.push({
    id: replacement, publisher: "org.example", version: "1.0.0", root,
    command: process.execPath, args: [fixture, "ledger-replacement"], files: { [fixture]: hash },
  });
  config.grants.push({
    caller: "host:demo", target: replacement, tool: "record",
    effects: "write", permissions: ["ledger.write"],
  });
  const host = await startHost(config);
  const triple = query("record", "task", "receipt");
  const call = { ...triple, arguments: { topic: "retained" }, idempotencyKey: "pin" };
  try {
    equal((await host.call("host:demo", call)).structuredContent.result.sequence, 1);
    host.select(triple, replacement);
    equal((await host.call("host:demo", call))._meta[errorKey].kind, "IDEMPOTENCY_CONFLICT");
    equal((await host.call("host:demo", { ...call, idempotencyKey: "fresh" })).structuredContent.result.sequence, 99);
  } finally {
    await host.close();
  }
});
