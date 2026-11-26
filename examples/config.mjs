import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => JSON.parse(readFileSync(join(root, path), "utf8"));
const pins = read("examples/pins.json");

export const contract = name => `urn:mmp:example:${name}:1.0.0`;
export const query = (name, input, output) => ({
  capability: `org.example/${name}`, inputContract: contract(input), outputContract: contract(output),
});
export const moduleId = name => `org.example.${name}`;
export const python = join(root, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");

export function createConfig(trace) {
  const groups = ["coordinator", "research", "python", "planner", "reviewer", "ledger", "adapter"];
  const packages = groups.map(role => {
    const pythonRole = role === "planner" || role === "python";
    const entry = pythonRole ? "examples/module.py" : "dist/examples/module.js";
    const common = [
      entry, `examples/descriptors/${role}.json`, ...(pythonRole ? [] : ["dist/sdk/typescript/index.js"]),
    ];
    return {
      id: moduleId(role), publisher: "org.example", version: "1.0.0",
      root, command: pythonRole ? python : process.execPath, args: [entry, role],
      files: Object.fromEntries(common.map(file => [file, pins[file]])),
      moduleEnvironment: role === "research" && process.env.MMP_RESEARCH_PROVIDER
        ? { MMP_RESEARCH_PROVIDER: process.env.MMP_RESEARCH_PROVIDER } : undefined,
    };
  });
  const grant = (caller, target, tool, effects = "read-only", permissions = []) => ({
    caller, target: moduleId(target), tool, effects, permissions,
  });
  const coordinator = moduleId("coordinator");
  const ledgerGrants = ["host:demo", "host:secondary", coordinator].map(caller =>
    grant(caller, "ledger", "record", "write", ["ledger.write"]));
  return {
    packages, trace, knownPermissions: ["ledger.write"],
    catalog: ["task", "report", "plan", "receipt", "amount-rub-major", "amount-rub-minor"].map(name => {
      const file = `contracts/${name}.json`;
      return { file: join(root, file), digest: pins[file] };
    }),
    grants: [
      grant("host:demo", "coordinator", "coordinate"),
      grant("host:demo", "coordinator", "cycle"),
      grant("host:demo", "coordinator", "recordNested"),
      grant("host:demo", "research", "research"),
      grant(coordinator, "coordinator", "cycle"),
      grant(coordinator, "research", "research"),
      grant(coordinator, "python", "research"),
      grant(coordinator, "python", "secondary"),
      grant(coordinator, "planner", "plan"),
      grant(moduleId("planner"), "reviewer", "review"),
      grant("host:demo", "adapter", "asKopecks"),
      grant("host:demo", "adapter", "takeKopecks"),
      ...ledgerGrants,
    ],
  };
}
