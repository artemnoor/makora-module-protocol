import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import { createHarness } from "../harness.mjs";
import { startDemo } from "../server.mjs";

let h;
before(() => { h = createHarness({ aiMode: "fixture", delay: 200 }); });
after(async () => { await h.close(); });
const operations = run => run.history.map(item => item.name);

async function until(get, states = ["waiting"], time = 45_000) {
  const end = Date.now() + time;
  for (;;) {
    const run = get();
    if (states.includes(run.status)) return run;
    if (run.status === "error" || Date.now() >= end) throw new Error(`Run ${run.status}: ${run.error}`);
    await delay(30);
  }
}

test("linear and a distinct reused configuration perform sequential MCP calls", async () => {
  const one = await h.runPattern("linear", "Линейный процесс");
  deepEqual(operations(one), ["metrics", "finalize"]);
  ok(one.history.every(step => step.traces.length === 1));
  ok(one.history[0].ended <= one.history[1].began);
  const two = await h.runPattern("repeat", "Цикл в другой системе", "offline");
  deepEqual(operations(two), ["revise", "revise", "revise", "finalize"]);
  equal(two.result.iteration, 3);
  equal(one.history.at(-1).traces[0].target, two.history.at(-1).traces[0].target);
});

test("root parallel calls overlap and join consumes two real outputs", async () => {
  const parallel = await h.runPattern("parallel", "Общий вход");
  const [a, b] = parallel.history;
  ok(Math.min(a.ended, b.ended) - Math.max(a.began, b.began) > 100);
  ok(parallel.result.left.notes.some(note => /Метрики/.test(note)));
  ok(parallel.result.right.notes.some(note => /fixture\/writer/.test(note)));
  const joined = await h.runPattern("join", "Объединённый вход");
  deepEqual(operations(joined), ["metrics", "analysis", "merge"]);
  equal(joined.result.notes.length, 2);
  ok(joined.history[2].began >= Math.max(joined.history[0].ended, joined.history[1].ended));
});

test("model output chooses both routes and normal logic chooses both without AI", async () => {
  for (const [pattern, system, tasks, source] of [
    ["ai-routing", "baseline", ["Compare two options", "One idea"], "fixture"],
    ["logic-routing", "offline", ["One two three four five", "One idea"], "logic"],
  ]) {
    const deep = await h.runPattern(pattern, tasks[0], system);
    const brief = await h.runPattern(pattern, tasks[1], system);
    equal(deep.decision.source, source);
    equal(brief.decision.source, source);
    deepEqual(operations(deep), ["review"]);
    deepEqual(operations(brief), ["metrics"]);
  }
});

test("real nested branches overlap, wait ends the MCP call, and resume takes one branch", async () => {
  const run = h.start("owner", "Сравни маршруты", "baseline");
  const waiting = await until(() => h.get("owner", run.id));
  equal(waiting.result, null);
  deepEqual(operations(waiting), ["dispatch", "merge"]);
  equal(waiting.decision.tool, "dispatch");
  match(waiting.decision.callId, /^fixture-/);
  const initial = waiting.history[0];
  const nested = initial.traces.filter(trace => /\.(metrics|analysis)$/.test(trace.chain.at(-1)));
  equal(nested.length, 2);
  ok(Math.min(...nested.map(trace => trace.ended)) -
    Math.max(...nested.map(trace => trace.ended - trace.latencyMs)) > 100);
  equal(new Set(initial.traces.map(event => event.correlationId)).size, 1);
  await delay(80);
  equal(h.get("owner", run.id).history.length, 2);
  match(await h.form("owner", run.id), /модуля A/);
  h.resume("owner", run.id, { userText: "вариант Б", choice: "algorithm" });
  const done = await until(() => h.get("owner", run.id), ["done"]);
  deepEqual(operations(done), ["dispatch", "merge", "algorithm", "revise", "revise", "normalize", "finalize"]);
  equal(done.result.iteration, 2);
  equal(done.result.userText, "вариант Б");
  ok(new Set(done.history.flatMap(step => step.traces.filter(e => e.chain.length === 1).map(e => e.correlationId))).size > 1);
});

test("reconfiguration replaces TS with Python, replaces AI, adds and reorders operations", async () => {
  const identifier = h.start("owner", "Оценка варианта", "reconfigured").id;
  const waiting = await until(() => h.get("owner", identifier));
  equal(waiting.decision.source, "logic");
  match(await h.form("owner", identifier), /модуля B/);
  const targets = waiting.history.flatMap(step => step.traces.map(item => item.target));
  ok(targets.some(item => item.endsWith("-metrics-py")));
  ok(targets.some(item => item.endsWith("-analysis-local")));
  h.resume("owner", identifier, { userText: "За два месяца", choice: "algorithm" });
  const done = await until(() => h.get("owner", identifier), ["done"]);
  deepEqual(operations(done).slice(-3), ["decorate", "finalize", "normalize"]);
  ok(done.history.at(-3).traces.some(event => event.target === "org.example.independent-decorator"));
  ok(done.result.notes.includes("Independent Python contribution"));
  equal(done.result.notes.some(note => /fixture\/|\[live/.test(note)), false);
});

test("offline without model calls, concurrent ownership and cancellation", async () => {
  const left = h.start("left", "Первый процесс", "offline");
  const right = h.start("right", "Второй процесс", "offline");
  const [leftWaiting, rightWaiting] = await Promise.all([
    until(() => h.get("left", left.id)),
    until(() => h.get("right", right.id)),
  ]);
  const leftCorrelations = new Set(leftWaiting.history.flatMap(record => record.traces.map(event => event.correlationId)));
  ok(leftCorrelations.size > 0);
  ok(rightWaiting.history.flatMap(record => record.traces).every(event => !leftCorrelations.has(event.correlationId)));
  await rejects(async () => h.get("left", right.id), { status: 404 });
  await rejects(async () => h.resume("left", left.id, { userText: "x", choice: "model" }), { status: 400 });
  h.cancel("left", left.id);
  h.resume("right", right.id, { userText: "Отдельные данные", choice: "algorithm" });
  const finished = await until(() => h.get("right", right.id), ["done"]);
  equal(finished.result.userText, "Отдельные данные");
  equal(h.get("left", left.id).status, "cancelled");
  ok(finished.result.notes.every(note => !/fixture\/|\[live/.test(note)));
  await rejects(() => h.cycleProbe("Вложенный цикл"), /CYCLE_DETECTED/);
});

test("cancelling an active MCP call stops the process before its next step", async () => {
  const { id } = h.start("operator", "Отмена на выполнении", "baseline");
  const end = Date.now() + 3000;
  while (!h.get("operator", id).history.length && Date.now() < end) await delay(5);
  equal(h.get("operator", id).history[0]?.outcome, "running");
  await delay(40);
  h.cancel("operator", id);
  await delay(300);
  const cancelled = h.get("operator", id);
  equal(cancelled.status, "cancelled");
  equal(cancelled.history[0].outcome, "cancelled");
  equal(cancelled.result, null);
  deepEqual(operations(cancelled), ["dispatch"]);
});

test("HTTP Harness checks origin and session ownership", async () => {
  const demo = await startDemo({ aiMode: "off", delay: 250 });
  try {
    const headers = { "content-type": "application/json", origin: demo.url };
    const post = JSON.stringify({ task: "Изоляция HTTP", system: "offline" });
    equal((await fetch(`${demo.url}/api/runs`, { method: "POST", headers, body: post })).status, 401);
    const a = (await fetch(demo.url)).headers.get("set-cookie").split(";")[0];
    const b = (await fetch(demo.url)).headers.get("set-cookie").split(";")[0];
    equal((await fetch(`${demo.url}/api/runs`, { method: "POST",
      headers: { ...headers, cookie: a, origin: "https://example.invalid" }, body: post,
    })).status, 403);
    const created = await (await fetch(`${demo.url}/api/runs`, { method: "POST",
      headers: { ...headers, cookie: a }, body: post,
    })).json();
    equal((await fetch(`${demo.url}/api/runs/${created.id}`, { headers: { cookie: b } })).status, 404);
    equal((await fetch(`${demo.url}/api/runs/${created.id}/cancel`, {
      method: "POST", headers: { ...headers, cookie: a },
    })).status, 200);
  } finally {
    await demo.close();
  }
});
