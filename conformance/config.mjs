import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConfig as createExampleConfig, contract, moduleId, python, query, root } from "../examples/config.mjs";

export { contract, moduleId, python, query, root };

export const digest = value => createHash("sha256").update(value).digest("hex");

export function createConfig(options = {}) {
  const trace = typeof options === "function" ? options : options.trace;
  const config = createExampleConfig(trace);
  if (options.maxDepth !== undefined) config.maxDepth = options.maxDepth;
  if (options.maxDurationMs !== undefined) config.maxDurationMs = options.maxDurationMs;
  return config;
}

export function fixturePackage(variant, id = moduleId("research")) {
  const file = "conformance/fixture.mjs";
  return {
    id, publisher: "org.example", version: "1.0.0", root,
    command: process.execPath, args: [file, variant],
    files: { [file]: digest(readFileSync(join(root, file))) },
  };
}
