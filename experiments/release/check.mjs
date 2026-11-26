import { deepEqual, equal, match, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extension, readProtocolSchema } from "@artemnoor/mmp";
import { startHost } from "@artemnoor/mmp/host";
import { createRun } from "./graph.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), "utf8"));
const digest = file => createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
const env = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const python = join(root, "python-provider", env);
const id = "urn:mmp:independent:reading:1.0.0";
const contract = join(root, "contracts/reading.json");
const nodeId = "org.independent.node";
const pythonId = "org.independent.python";
const adapterId = "org.independent.adapter";
const legacyId = "org.example.python";
const tsStarter = "org.example.typescript-echo";
const pyStarter = "org.example.python-echo";
const nodeEntry = "node-provider/provider.mjs";
const pyEntry = "python-provider/src/mmp_independent_python/server.py";
const trace = [];
let modelRequests = 0;
const fixture = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { source } = JSON.parse(Buffer.concat(chunks).toString());
  modelRequests++;
  res.end(JSON.stringify({ suggestion: `Controlled inference: review ${source.trim()}` }));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const packagePin = (id, publisher, command, args, files, moduleEnvironment) => ({
  id, publisher, version: "1.0.0", root, command, args,
  files: Object.fromEntries(files.map(file => [file, digest(file)])), moduleEnvironment,
});
const pins = [
  packagePin(nodeId, "org.independent", process.execPath, [nodeEntry], [nodeEntry], { LAB_CONTRACT: contract, LAB_NESTED: "1" }),
  packagePin(pythonId, "org.independent", python, [pyEntry], [pyEntry], { LAB_CONTRACT: contract, MMP_EXTENSION_ID: extension }),
  packagePin(adapterId, "org.independent", process.execPath, ["adapter.mjs"], ["adapter.mjs"],
    { LAB_INFERENCE_URL: `http://127.0.0.1:${fixture.address().port}` }),
  packagePin(legacyId, "org.example", python, ["existing/examples/module.py", "python"], [
    "existing/examples/module.py", "existing/examples/descriptors/python.json",
  ]),
  packagePin(tsStarter, "org.example", process.execPath, ["starters/typescript/dist/server.js"],
    ["starters/typescript/dist/server.js", "starters/typescript/contract.json"]),
  packagePin(pyStarter, "org.example", python, ["starters/python/server.py"],
    ["starters/python/server.py", "starters/python/contract.json"]),
];
const grant = (caller, target, tool) => ({ caller, target, tool, effects: "read-only", permissions: [] });
let host;
try {
  host = await startHost({
  packages: pins,
  catalog: ["contracts/reading.json", "contracts/pair.json", "existing/contracts/task.json", "existing/contracts/report.json",
    "starters/typescript/contract.json"]
    .map(file => ({ file: join(root, file), digest: digest(file) })),
  grants: [
    grant("host:external", nodeId, "classify"), grant("host:external", nodeId, "normalize"),
    grant("host:external", pythonId, "classify"), grant(nodeId, pythonId, "annotate"),
    grant("host:external", adapterId, "merge"), grant("host:external", adapterId, "to-task"),
    { caller: "host:external", target: adapterId, tool: "assist", effects: "external", permissions: ["inference.generate"] },
    grant("host:external", legacyId, "research"),
    grant("host:external", tsStarter, "echo"), grant("host:external", pyStarter, "echo"),
  ],
  knownPermissions: ["inference.generate"],
  trace: event => trace.push(event),
  });
  equal(readProtocolSchema("invoke").type, "object");
  const exported = await import("@artemnoor/mmp/schemas/invoke", { with: { type: "json" } });
  deepEqual(exported.default, readProtocolSchema("invoke"));
  equal(read("node_modules/@artemnoor/mmp/package.json").version, "0.1.0");
  const reading = { source: " station 7 ", amount: 82, severity: "pending", notes: [] };
  const run = (name, value = reading) => createRun(host, read(`graphs/${name}.json`), { reading: value });
  const one = run("parallel");
  const parallel = await one.advance();
  equal(parallel.status, "done");
  ok(Math.min(one.history[0].ended, one.history[1].ended) > Math.max(one.history[0].started, one.history[1].started));
  equal(parallel.values.merge.severity, "review");
  ok(parallel.values.merge.notes.some(note => /python annotation/i.test(note)));
  match(parallel.values.research.findings[0], /station 7\/review/);
  ok(trace.some(event => event.caller === nodeId && event.target === pythonId && event.chain.length > 1));
  const low = await run("parallel", { ...reading, amount: 10 }).advance();
  equal(low.values.merge.severity, "normal");
  equal(Object.hasOwn(low.values, "research"), false);
  const linear = run("linear");
  await linear.advance();
  deepEqual(linear.history.map(step => step.id), ["classify", "normalize"]);
  const assisted = run("assisted");
  equal((await assisted.advance()).status, "waiting");
  deepEqual(assisted.history.map(step => step.id), ["normalize"]);
  const resumed = await assisted.advance("operator confirmed");
  match(resumed.values.research.findings[0], /operator confirmed\/review/);
  host.select({ capability: "org.independent/classify", inputContract: id, outputContract: id }, pythonId);
  const replaced = await run("linear").advance();
  equal(replaced.values.normalize.severity, "review");
  ok(replaced.values.normalize.notes.some(note => /classified/i.test(note)));
  const lastClassifier = trace.findLast(event => event.chain[0] === "org.independent/classify");
  equal(lastClassifier.target, pythonId);
  equal(modelRequests, 0);
  const augmented = createRun(host, read("graphs/optional-inference.json"), { reading, useInference: true });
  const augmentedResult = await augmented.advance();
  ok(augmentedResult.values.assist.notes.some(note => /Controlled inference/.test(note)));
  equal(modelRequests, 1);
  const message = "urn:mmp:starter:message:1.0.0";
  const echo = { capability: "org.example/echo", inputContract: message, outputContract: message };
  for (const provider of [tsStarter, pyStarter]) {
    host.select(echo, provider);
    const response = await host.call("host:external", { ...echo, arguments: { message: "Hello, independently" } });
    deepEqual(response.structuredContent.result, { message: "Hello, independently" });
    equal(trace.at(-1).target, provider);
  }
  const localOnly = createRun(host, read("graphs/optional-inference.json"), { reading, useInference: false });
  equal(Object.hasOwn((await localOnly.advance()).values, "assist"), false);
  equal(modelRequests, 1);
  console.log(JSON.stringify({
    namespace: extension, graphs: ["parallel", "linear", "assisted", "optional-inference"], conditionalBranches: 2,
    nested: `${nodeId} → ${pythonId}`, replacement: `${nodeId} → ${pythonId}`,
    existing: legacyId, noAiRequests: 0, controlledInferenceRequests: modelRequests, checks: "PASS",
  }, null, 2));
} finally {
  await host?.close();
  const closed = once(fixture, "close");
  fixture.close();
  fixture.closeAllConnections();
  await closed;
}
