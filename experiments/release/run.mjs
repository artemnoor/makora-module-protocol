import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const experiment = fileURLToPath(new URL("./", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm run verify:external");
const target = mkdtempSync(join(tmpdir(), "mmp-external-"));
writeFileSync(join(target, "package.json"), JSON.stringify({ private: true, type: "module" }));
console.log(`Independent workspace: ${target}`);
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Failed: ${args.join(" ")} (${result.status})`);
}
const npm = (args, cwd = target) => run(process.execPath, [npmCli, ...args], cwd);
for (const file of ["adapter.mjs", "graph.mjs", "check.mjs", "contracts", "graphs", "node-provider", "python-provider"]) {
  cpSync(join(experiment, file), join(target, file), {
    recursive: true, filter: source => !source.split(/[\\/]/).some(part => [".venv", "node_modules", "__pycache__"].includes(part)),
  });
}
for (const file of ["examples/module.py", "examples/descriptors/python.json", "contracts/task.json", "contracts/report.json"]) {
  const path = join(target, "existing", file);
  mkdirSync(dirname(path), { recursive: true });
  cpSync(join(repo, file), path);
}
for (const language of ["typescript", "python"]) {
  const path = join(target, "starters", language);
  cpSync(join(repo, "templates", language), path, { recursive: true });
  cpSync(join(repo, "templates/contract.json"), join(path, "contract.json"));
}
npm(["pack", "--pack-destination", target], repo);
npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "./artemnoor-mmp-0.1.0.tgz",
  "@modelcontextprotocol/server@2.4.0", "typescript@5.9.3", "@types/node@22.18.8"]);
npm(["run", "build"], join(target, "starters/typescript"));
run("uv", ["sync", "--locked"], join(target, "python-provider"));
run(process.execPath, ["check.mjs"], target);
console.log(`Installed version: ${JSON.parse(readFileSync(join(target, "node_modules/@artemnoor/mmp/package.json"), "utf8")).version}`);
