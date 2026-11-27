import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createRun } from "../experiments/release/graph.mjs";
import { createConfig, moduleId, query } from "./config.mjs";
import { label, start } from "./harness.mjs";

const read = name => JSON.parse(readFileSync(new URL(`./graphs/${name}.json`, import.meta.url), "utf8"));
const grant = (caller, target, tool) => ({ caller, target, tool, effects: "read-only", permissions: [] });
let host;
const run = (name, input) => createRun(host, read(name), input);

before(async () => {
  const config = createConfig();
  config.grants.push(
    grant("host:external", moduleId("research"), "research"),
    grant("host:external", moduleId("python"), "research"),
    grant("host:external", moduleId("adapter"), "asKopecks"),
    grant("host:external", moduleId("adapter"), "takeKopecks"),
    grant("host:external", moduleId("coordinator"), "coordinate"),
  );
  host = await start(config);
});
after(async () => { await host?.close(); });

test(label("the same JSON graph supports sequential steps"), async () => {
  const result = await run("sequential").advance();
  equal(result.status, "done");
  deepEqual(result.values.convert, { amount: 300, currency: "RUB", unit: "minor" });
  deepEqual(result.values.accept, result.values.convert);
});

test(label("the same JSON graph supports parallel overlap"), async () => {
  const execution = run("parallel");
  const result = await execution.advance();
  equal(result.status, "done");
  equal(execution.history.length, 2);
  ok(Math.min(execution.history[0].ended, execution.history[1].ended) >
    Math.max(execution.history[0].started, execution.history[1].started));
  deepEqual(result.values.left.findings, ["typescript: overlap-left"]);
  deepEqual(result.values.right.findings, ["typescript: overlap-right"]);
});

test(label("the same JSON graph supports conditional branches"), async () => {
  const skipped = await run("conditional", { run: false }).advance();
  deepEqual(Object.hasOwn(skipped.values, "accept"), false);
  const taken = await run("conditional", { run: true }).advance();
  deepEqual(taken.values.accept, taken.values.convert);
});

test(label("the same JSON graph supports nested cross-language calls"), async () => {
  const result = await run("nested").advance();
  deepEqual(result.values.coordinate.findings, [
    "reviewed nested graph", "typescript: nested graph", "secondary via python: nested graph",
  ]);
});

test(label("the same JSON graph supports operator resume"), async () => {
  const execution = run("operator");
  const waiting = await execution.advance();
  equal(waiting.status, "waiting");
  equal(waiting.prompt, "Enter the operator label");
  const resumed = await execution.advance("operator label");
  equal(resumed.status, "done");
  deepEqual(resumed.values.research.findings, ["typescript: operator label"]);
});

test(label("the same JSON graph supports provider substitution"), async () => {
  const baseline = await run("replacement").advance();
  deepEqual(baseline.values.research.findings, ["typescript: replacement"]);
  await host.select(query("research", "task", "report"), moduleId("python"));
  try {
    const replaced = await run("replacement").advance();
    deepEqual(replaced.values.research.findings, ["research via python: replacement"]);
  } finally {
    await host.select(query("research", "task", "report"), moduleId("research"));
  }
});

test(label("the same JSON graph runs without inference and stays deterministic"), async () => {
  const first = await run("sequential").advance();
  const second = await run("sequential").advance();
  deepEqual(second.values, first.values);
});
