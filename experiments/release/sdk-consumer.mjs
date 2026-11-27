import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = fileURLToPath(new URL("../../", import.meta.url));
const fixture = fileURLToPath(new URL("./sdk-consumer/", import.meta.url));
const registry = "https://registry.npmjs.org/";
const expectedVersion = "0.1.0";
const usage = [
  "Usage: node experiments/release/sdk-consumer.mjs <tarball|npm-spec>",
  "",
  "  tarball    Path to artemnoor-mmp-0.1.0.tgz, for the release candidate.",
  "  npm-spec   Exactly @artemnoor/mmp@0.1.0 after publication. Uses the public registry only.",
  "",
  "With no argument the script looks for artemnoor-mmp-0.1.0.tgz in the checkout root.",
].join("\n");

function fail(message) {
  throw new Error(message);
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
}

function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules", "npm", "bin", "npm-cli.js"),
    "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    "/usr/lib/node_modules/npm/bin/npm-cli.js",
  ].filter(Boolean);
  return candidates.find(path => existsSync(path));
}

function npm(args, cwd, environment = {}) {
  const cli = npmCli();
  const options = { env: { ...process.env, ...environment } };
  if (cli) return run(process.execPath, [cli, ...args], cwd, options);
  if (process.platform === "win32") {
    fail("Cannot locate npm-cli.js. Run through npm or install npm next to node.");
  }
  return run("npm", args, cwd, options);
}

let mode;
let source;
const argument = process.argv[2];
if (process.argv.length > 3) fail(usage);
if (argument) {
  const path = resolve(argument);
  if (existsSync(path) && statSync(path).isFile()) {
    mode = "tarball";
    source = path;
  } else if (/\.(?:tgz|tar\.gz)$/i.test(argument)) {
    fail(`Tarball not found: ${path}`);
  } else {
    const registrySpec = `@artemnoor/mmp@${expectedVersion}`;
    if (argument !== registrySpec) {
      fail(`The npm spec must be the exact release version ${registrySpec}`);
    }
    mode = "registry";
    source = argument;
  }
} else {
  const fallback = join(checkout, "artemnoor-mmp-0.1.0.tgz");
  if (!existsSync(fallback)) fail(`No tarball argument and ${fallback} does not exist.\n\n${usage}`);
  mode = "tarball";
  source = fallback;
}

const target = mkdtempSync(join(tmpdir(), "mmp-sdk-consumer-"));
console.log(`Clean consumer workspace: ${target}`);
console.log(`Package source: ${mode === "registry" ? `${source} from ${registry}` : source}`);
let success = false;
try {
  writeFileSync(join(target, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  if (mode === "registry") {
    writeFileSync(join(target, ".npmrc"), [
      `registry=${registry}`,
      `@artemnoor:registry=${registry}`,
      "audit=false",
      "fund=false",
      "",
    ].join("\n"));
  }
  for (const entry of readdirSync(fixture)) {
    cpSync(join(fixture, entry), join(target, entry), { recursive: true });
  }
  const npmEnvironment = mode === "registry" ? { npm_config_registry: registry } : {};
  try {
    npm([
      "install", "--ignore-scripts", "--no-audit", "--no-fund",
      "--registry", registry, `--@artemnoor:registry=${registry}`,
      source,
      "@modelcontextprotocol/server@2.4.0", "typescript@5.9.3", "@types/node@22.18.8",
    ], target, npmEnvironment);
  } catch (error) {
    if (mode === "registry") {
      fail(`Registry install failed for ${source}. This script published nothing; if the package is still a release candidate, use the tarball form.\n${error.message}`);
    }
    throw error;
  }

  if (mode === "registry") {
    const lock = JSON.parse(readFileSync(join(target, "package-lock.json"), "utf8"));
    const outside = Object.entries(lock.packages ?? {}).flatMap(([name, entry]) =>
      entry.resolved && !entry.resolved.startsWith(registry) ? [`${name || "root"}: ${entry.resolved}`] : []);
    if (outside.length) {
      fail(`package-lock.json resolved outside ${registry}:\n${outside.join("\n")}`);
    }
    const pinned = lock.packages?.["node_modules/@artemnoor/mmp"]?.resolved;
    if (!pinned?.startsWith(registry)) {
      fail(`package-lock.json does not pin @artemnoor/mmp to ${registry}`);
    }
  }

  const installed = JSON.parse(readFileSync(join(target, "node_modules/@artemnoor/mmp/package.json"), "utf8"));
  if (installed.version !== expectedVersion) {
    fail(`Expected @artemnoor/mmp@${expectedVersion}, installed ${installed.version}`);
  }
  run(process.execPath, [join(target, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"], target);
  run(process.execPath, ["smoke.mjs"], target, {
    env: { ...process.env, npm_config_registry: registry },
  });
  success = true;
  console.log(JSON.stringify({
    mode,
    source,
    registry: mode === "registry" ? registry : "local tarball; dependencies from the public registry",
    registryLock: mode === "registry" ? "PASS" : "not applicable",
    version: installed.version,
    result: "PASS",
    publish: "not attempted",
  }, null, 2));
} finally {
  if (success) {
    rmSync(target, { recursive: true, force: true });
  } else {
    console.error(`Workspace kept for inspection: ${target}`);
  }
}
