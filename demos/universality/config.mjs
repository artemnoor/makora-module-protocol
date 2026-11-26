import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { settings } from "./model.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
const base = "demos/universality/";
const worker = "dist/demos/universality/modules/worker.js";
const documentPath = base + "contracts/document.json";
const pairPath = base + "contracts/pair.json";
const sdk = "dist/sdk/typescript/index.js";
const pins = JSON.parse(readFileSync(new URL("pins.json", import.meta.url), "utf8"));
export const doc = "urn:mmp:universal:document:1.0.0";
export const pair = "urn:mmp:universal:pair:1.0.0";
export const caller = "host:universality";
export const systems = {
  baseline: { title: "Исходная", ai: true, logic: false, merge: "merge", metrics: "metrics" },
  reconfigured: { title: "Перекомпоновка", ai: false, logic: true, merge: "merge-alt", metrics: "metrics-py" },
  offline: { title: "Без AI", ai: false, logic: true, merge: "merge", metrics: "metrics" },
};

export const capability = name => `org.example/universal.${name}`;
export const operation = (name, inputContract = doc, outputContract = doc) => ({
  capability: capability(name), inputContract, outputContract,
});
const descriptorId = name => name === "decorate" ? "org.example.independent-decorator" : `org.example.universal-${name}`;
const specs = {
  dispatch: { output: pair, requires: ["metrics", "analysis", "review"] },
  metrics: {},
  "metrics-py": { capability: "metrics", tool: "metrics", entry: base + "modules/metrics.py" },
  analysis: { ai: true },
  "analysis-local": { capability: "analysis", tool: "local_analysis" },
  review: {},
  merge: { input: pair },
  "merge-alt": { input: pair, capability: "merge", tool: "merge" },
  algorithm: {},
  model: { ai: true },
  revise: {},
  normalize: {},
  finalize: {},
  decorate: { entry: base + "third-party/src/mmp_independent_decorator/server.py" },
  cycle: { requires: ["cycle"] },
};

const read = file => readFileSync(join(root, file));
export function verifyModuleFiles(pin) {
  for (const [file, expected] of Object.entries(pin.files)) {
    if (createHash("sha256").update(read(file)).digest("hex") !== expected) throw new Error(`Module pin mismatch: ${file}`);
  }
}

function digest(file) {
  const expected = pins[file];
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) throw new Error(`Missing pinned artifact: ${file}`);
  return expected;
}

export function createConfig(system, { aiMode, delay = 0, trace, maxDurationMs = 60_000 } = {}) {
  const variant = systems[system];
  if (!variant) throw new Error("Unknown system");
  const useModel = variant.ai && aiMode !== "off";
  const roles = ["dispatch", variant.metrics, useModel ? "analysis" : "analysis-local", "review",
    variant.merge, "algorithm", "revise", "finalize", "cycle"];
  if (system === "baseline") roles.push("normalize");
  if (system === "reconfigured") roles.push("decorate", "normalize");
  if (useModel) roles.push("model");
  const descriptors = new Map();
  const packages = roles.map(role => {
    const spec = specs[role];
    const effects = spec.ai ? "external" : "read-only";
    const permissions = spec.ai ? ["model.generate"] : [];
    const descriptor = {
      id: descriptorId(role), publisher: "org.example", version: "1.0.0", mmpVersion: "0.1.0",
      description: `Universality demo module ${role}`,
      requires: (spec.requires ?? []).map(name => operation(name)),
      operations: [{
        ...operation(spec.capability ?? role, spec.input, spec.output),
        tool: spec.tool ?? role, permissions, effects, execution: "sync", idempotency: { mode: "natural" },
      }],
    };
    descriptors.set(role, descriptor);
    const entry = spec.entry ?? worker;
    const pythonRoot = role === "decorate" ? join(root, base, "third-party") : root;
    const python = join(pythonRoot, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
    const moduleEnvironment = {
      MMP_DEMO_DESCRIPTOR: JSON.stringify(descriptor), MMP_DEMO_CONTRACT: join(root, documentPath),
      MMP_DEMO_AI: useModel ? aiMode : "off", MMP_DEMO_ROUTING: variant.logic || !useModel ? "logic" : "model",
      MMP_DEMO_DELAY: String(delay),
    };
    const models = settings();
    if (spec.ai && aiMode === "live") {
      moduleEnvironment.MMP_ROUTE_MODEL = models.route;
      moduleEnvironment.MMP_WORK_MODEL = models.work;
      moduleEnvironment.MMP_AI_ENDPOINT = models.endpoint;
      if (models.key) moduleEnvironment.MMP_AI_KEY = models.key;
    }
    const artifacts = spec.entry ? [entry, documentPath]
      : [entry, sdk, base + "model.mjs", base + "surface.mjs", documentPath, pairPath];
    return {
      id: descriptor.id, publisher: descriptor.publisher, version: descriptor.version,
      root, command: spec.entry ? python : process.execPath, args: spec.entry ? [entry] : [entry, role],
      files: Object.fromEntries(artifacts.map(file => [file, digest(file)])), moduleEnvironment,
    };
  });
  function grant(identity, target) {
    const descriptor = descriptors.get(target);
    const { tool, effects, permissions } = descriptor.operations[0];
    return { caller: identity, target: descriptor.id, tool, effects, permissions };
  }
  return {
    uiPackage: packages.find(pin => pin.id === descriptorId(variant.merge)),
    host: {
      catalog: [documentPath, pairPath].map(file => ({ file: join(root, file), digest: digest(file) })),
      packages,
      knownPermissions: ["model.generate"],
      grants: [
        ...roles.map(role => grant(caller, role)),
        grant(descriptorId("dispatch"), variant.metrics),
        grant(descriptorId("dispatch"), useModel ? "analysis" : "analysis-local"),
        grant(descriptorId("dispatch"), "review"),
        grant(descriptorId("cycle"), "cycle"),
      ],
      maxDurationMs, trace,
    },
  };
}
