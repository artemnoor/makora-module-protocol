import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const experiment = fileURLToPath(new URL("./", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm run verify:external");
const argument = process.argv.find(item => item.startsWith("--hosts="));
const hosts = (argument ? argument.slice("--hosts=".length) : "typescript")
  .split(",").map(item => item.trim()).filter(Boolean);
for (const host of hosts) if (!["typescript", "python"].includes(host)) throw new Error(`Unknown Host: ${host}`);
const target = mkdtempSync(join(tmpdir(), "mmp-external-"));
writeFileSync(join(target, "package.json"), JSON.stringify({ private: true, type: "module" }));
console.log(`Independent workspace: ${target}`);
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Failed: ${args.join(" ")} (${result.status})`);
}
const npm = (args, cwd = target) => run(process.execPath, [npmCli, ...args], cwd);
const copy = (source, destination) => cpSync(source, destination, {
  recursive: true,
  filter: path => !path.split(/[\\/]/).some(part => [".venv", "node_modules", "__pycache__"].includes(part)),
});
npm(["pack", "--pack-destination", target], repo);
for (const file of ["adapter.mjs", "graph.mjs", "check.mjs", "contracts", "graphs", "node-provider", "python-provider"]) {
  cpSync(join(experiment, file), join(target, file), {
    recursive: true, filter: source => !source.split(/[\\/]/).some(part => [".venv", "node_modules", "__pycache__"].includes(part)),
  });
}
copy(join(repo, "conformance/host-adapters"), join(target, "host-adapters"));
cpSync(join(repo, "conformance/python-bridge.py"), join(target, "python-bridge.py"));
for (const file of [
  "examples/module.py", "examples/descriptors/python.json", "examples/descriptors/planner.json",
  "examples/descriptors/reviewer.json", "contracts/task.json", "contracts/report.json", "contracts/plan.json",
]) {
  const path = join(target, "existing", file);
  mkdirSync(dirname(path), { recursive: true });
  cpSync(join(repo, file), path);
}
for (const [source, destination] of [
  ["dist/examples/module.js", "existing/dist/examples/module.js"],
  ["dist/sdk/typescript/index.js", "existing/dist/sdk/typescript/index.js"],
]) {
  const path = join(target, destination);
  mkdirSync(dirname(path), { recursive: true });
  cpSync(join(repo, source), path);
}
for (const language of ["typescript", "python"]) {
  const path = join(target, "starters", language);
  cpSync(join(repo, "templates", language), path, { recursive: true });
  cpSync(join(repo, "templates/contract.json"), join(path, "contract.json"));
}
npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "./artemnoor-mmp-0.1.0.tgz",
  "@modelcontextprotocol/server@2.4.0", "typescript@5.9.3", "@types/node@22.18.8"]);
npm(["run", "build"], join(target, "starters/typescript"));
run("uv", ["sync", "--locked"], join(target, "python-provider"));
if (hosts.includes("python")) {
  const pythonHost = join(repo, "python-host");
  if (!existsSync(join(pythonHost, "pyproject.toml"))) {
    throw new Error("python-host/pyproject.toml is required for --hosts=python");
  }
  copy(pythonHost, join(target, "python-host"));
  run("uv", ["sync", "--locked"], join(target, "python-host"));
}
run(process.execPath, ["check.mjs", `--hosts=${hosts.join(",")}`], target);
console.log(`Installed version: ${JSON.parse(readFileSync(join(target, "node_modules/@artemnoor/mmp/package.json"), "utf8")).version}`);
