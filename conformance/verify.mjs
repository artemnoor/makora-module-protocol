import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_LANGUAGES } from "./host-adapters/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argument = process.argv.find(item => item.startsWith("--hosts="));
const requested = argument
  ? argument.slice("--hosts=".length).split(",").map(item => item.trim()).filter(Boolean)
  : [...HOST_LANGUAGES];
if (!requested.length || requested.some(item => !HOST_LANGUAGES.includes(item))) {
  console.error(`Expected --hosts=${HOST_LANGUAGES.join(",")}`);
  process.exit(2);
}

const bridgeTest = resolve(here, "bridge.encoding.test.mjs");
const common = readdirSync(here)
  .filter(file => file.endsWith(".test.mjs") && file !== "architecture.test.mjs" &&
    file !== "bridge.encoding.test.mjs" && !/\.(typescript|python)\.test\.mjs$/.test(file))
  .sort()
  .map(file => resolve(here, file));

function runTests(title, files, environment = {}) {
  console.log(`\n=== ${title} ===`);
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
      cwd: resolve(here, ".."), stdio: "inherit",
      env: { ...process.env, ...environment },
    });
    child.on("error", error => {
      console.error(error);
      resolveRun(1);
    });
    child.on("exit", (code, signal) => resolveRun(code ?? (signal ? 1 : 0)));
  });
}

const bridgeCode = await runTests("MMP Python bridge encoding", [bridgeTest]);
const results = [];
for (const language of requested) {
  const specific = resolve(here, `trace.${language}.test.mjs`);
  const files = existsSync(specific) ? [...common, specific] : common;
  results.push({ language, code: await runTests(`MMP Host conformance: ${language}`, files, {
    MMP_CONFORMANCE_HOST: language,
  }) });
}
console.log("\n=== Host conformance summary ===");
console.log(`bridge: ${bridgeCode === 0 ? "PASS" : `FAIL (exit ${bridgeCode})`}`);
for (const { language, code } of results) console.log(`${language}: ${code === 0 ? "PASS" : `FAIL (exit ${code})`}`);
process.exit(bridgeCode === 0 && results.every(result => result.code === 0) ? 0 : 1);
