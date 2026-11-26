// A small experiment outside the profile. Only the installed public Host is called.
const skipped = Symbol("skipped");

function substitute(value, known, input) {
  if (Array.isArray(value)) return value.map(item => substitute(item, known, input));
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 1 && Object.hasOwn(value, "$ref")) {
    const [key, ...parts] = value.$ref.split(".");
    let current = key === "input" ? input : known.get(key);
    for (const field of parts) current = current && Object.hasOwn(current, field) ? current[field] : undefined;
    if (current === undefined || current === skipped) throw new Error(`Missing graph input: ${value.$ref}`);
    return current;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, known, input)]));
}

export function createRun(host, graph, input, { signal } = {}) {
  const pending = new Map(graph.steps.map(step => [step.id, step]));
  if (pending.size !== graph.steps.length) throw new Error("Duplicate step ID");
  const known = new Map();
  const history = [];
  let busy = false;

  return {
    history,
    async advance(answer) {
      if (busy) throw new Error("Run already advancing");
      busy = true;
      try {
        while (pending.size) {
          signal?.throwIfAborted();
          const ready = [...pending.values()].filter(step => step.after.every(parent => known.has(parent)));
          if (!ready.length) throw new Error("Missing dependency or cycle in graph");
          const pause = ready.find(step => step.prompt);
          if (pause && typeof answer !== "string") return { status: "waiting", prompt: pause.prompt };
          await Promise.all(ready.map(async step => {
            if (step.prompt) {
              if (!answer.trim() || answer.length > 120) throw new Error("Invalid checkpoint answer");
              known.set(step.id, answer);
            } else if (step.when && substitute(step.when.ref, known, input) !== step.when.equals) {
              known.set(step.id, skipped);
            } else {
              const started = performance.now();
              const result = await host.call("host:external", {
                ...step.invoke, arguments: substitute(step.arguments, known, input),
              }, { signal });
              history.push({ id: step.id, started, ended: performance.now() });
              if (result.isError) throw new Error(result.content[0]?.text ?? "MMP call failed");
              known.set(step.id, result.structuredContent.result);
            }
            pending.delete(step.id);
          }));
          answer = undefined;
        }
        return { status: "done", values: Object.fromEntries([...known].filter(([, v]) => v !== skipped)) };
      } finally {
        busy = false;
      }
    },
  };
}
