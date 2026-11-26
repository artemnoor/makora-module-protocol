import { setTimeout as delay } from "node:timers/promises";
import { createHarness } from "./harness.mjs";

const harness = createHarness({ aiMode: "live" });
async function until(id, status) {
  for (let round = 0; round < 450; round++) {
    const run = harness.get("operator", id);
    if (run.status === status) return run;
    if (run.status === "error") {
      const operation = run.history.findLast(step => step.outcome === "error")?.name ?? "routing";
      throw new Error(`Live integration failed at ${operation}: ${run.error}`);
    }
    await delay(200);
  }
  throw new Error("Live integration timed out");
}
try {
  const started = harness.start("operator", "Compare two ways to store energy for a small garden lamp.", "baseline");
  const waiting = await until(started.id, "waiting");
  harness.resume("operator", started.id, { choice: "model", userText: "Only compare options suitable for a classroom prototype." });
  const done = await until(started.id, "done");
  const evidence = {
    route: waiting.decision,
    modelNotes: done.result.notes.filter(note => note.startsWith("[live")),
    mmpCalls: done.history.flatMap(step => step.traces.map(event => event.target)),
  };
  if (evidence.route.source !== "live" || evidence.modelNotes.length < 2 ||
    evidence.modelNotes.some(note => note.startsWith(`[live · ${evidence.route.model}]`))) {
    throw new Error("Both live model stages require a different model from the router");
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await harness.close();
}
