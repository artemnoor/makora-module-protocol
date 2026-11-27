import { deepEqual, equal, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extension, profile, readProtocolSchema, revision } from "@artemnoor/mmp";
import { startHost } from "@artemnoor/mmp/host";

const root = fileURLToPath(new URL("./", import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), "utf8"));
const digest = file => createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
const schemaIds = {
  invoke: "urn:mmp:schema:invoke:0.1.0",
  "module-descriptor": "urn:mmp:schema:module-descriptor:0.1.0",
  "execution-context": "urn:mmp:schema:execution-context:0.1.0",
  error: "urn:mmp:schema:error:0.1.0",
};

equal(revision, "2026-07-28");
equal(profile, "0.1.0");
equal(extension, "io.github.artemnoor/mmp");
equal(read("node_modules/@artemnoor/mmp/package.json").version, "0.1.0");

const installed = new URL("./node_modules/", import.meta.url).href;
for (const name of Object.keys(schemaIds)) {
  const schema = readProtocolSchema(name);
  equal(schema.$id, schemaIds[name]);
  equal(schema.type, "object");
  const specifier = `@artemnoor/mmp/schemas/${name}`;
  ok(import.meta.resolve(specifier).startsWith(installed), `${specifier} must resolve from this project`);
  const exported = await import(specifier, { with: { type: "json" } });
  deepEqual(exported.default, schema);
}
for (const specifier of ["@artemnoor/mmp", "@artemnoor/mmp/host"]) {
  ok(import.meta.resolve(specifier).startsWith(installed), `${specifier} must resolve from this project`);
}

const moduleId = "org.example.consumer-echo";
const contract = read("contract.json").schema.$id;
const trace = [];
const host = await startHost({
  catalog: [{ file: join(root, "contract.json"), digest: digest("contract.json") }],
  packages: [{
    id: moduleId,
    publisher: "org.example",
    version: "1.0.0",
    root,
    command: process.execPath,
    args: ["dist/module.js"],
    files: {
      "dist/module.js": digest("dist/module.js"),
      "contract.json": digest("contract.json"),
    },
  }],
  grants: [{
    caller: "host:consumer",
    target: moduleId,
    tool: "echo",
    effects: "read-only",
    permissions: [],
  }],
  knownPermissions: [],
  trace: event => trace.push(event),
});
try {
  const message = "Hello from a clean consumer";
  const result = await host.call("host:consumer", {
    capability: "org.example/consumer-echo",
    inputContract: contract,
    outputContract: contract,
    arguments: { message },
  });
  ok(!result.isError, "The installed SDK module must return a successful result");
  deepEqual(result.structuredContent, { outputContract: contract, result: { message } });
  equal(trace.at(-1)?.caller, "host:consumer");
  equal(trace.at(-1)?.target, moduleId);
  console.log(JSON.stringify({
    checks: {
      package: "@artemnoor/mmp@0.1.0",
      strictTypeScript: "PASS",
      schemas: Object.keys(schemaIds),
      hostCall: "PASS",
      checkoutImports: 0,
    },
  }, null, 2));
} finally {
  await host.close();
}
