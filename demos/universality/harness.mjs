import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startHost } from "../../dist/reference/host/index.js";
import { connect, errorKey } from "../../dist/sdk/typescript/index.js";
import { caller, createConfig, doc, operation, pair, systems, verifyModuleFiles } from "./config.mjs";
import { requestModel, settings } from "./model.mjs";
import { resourceMime, resourceUri } from "./surface.mjs";

export const patterns = ["linear", "parallel", "ai-routing", "logic-routing", "join", "wait", "repeat"];
const empty = task => ({ task, mode: "brief", notes: [], choice: "", userText: "", iteration: 0 });
const requestError = (message, status = 400) => Object.assign(new Error(message), { status });

export function createHarness({ aiMode = "fixture", delay = 0, maxDurationMs = 60_000 } = {}) {
  if (!["off", "fixture", "live"].includes(aiMode) || aiMode === "live" && !settings().key) {
    throw new Error("Invalid demo AI configuration");
  }
  const local = new AsyncLocalStorage();
  const hosts = new Map();
  const runs = new Map();
  const traces = new Map();
  const forms = new Map();
  const expiresAfter = 30 * 60_000;
  let closing = false;

  function acceptTrace(event) {
    event = { ...event, ended: performance.now() };
    if (event.caller !== caller) {
      const waiting = traces.get(event.correlationId) ?? [];
      if (!waiting.length && traces.size >= 250) traces.delete(traces.keys().next().value);
      traces.set(event.correlationId, [...waiting.slice(-63), event]);
      return;
    }
    const call = local.getStore();
    const children = traces.get(event.correlationId) ?? [];
    traces.delete(event.correlationId);
    if (call) call.traces.push(event, ...children);
  }

  function config(system) {
    return createConfig(system, { aiMode, delay, maxDurationMs, trace: acceptTrace });
  }
  function host(system) {
    if (closing) throw new Error("Harness is closed");
    if (!Object.hasOwn(systems, system)) throw requestError("Неизвестная система");
    if (!hosts.has(system)) {
      hosts.set(system, startHost(config(system).host).catch(error => {
        hosts.delete(system);
        throw error;
      }));
    }
    return hosts.get(system);
  }

  async function invoke(run, name, args, input = doc, output = doc) {
    run.controller.signal.throwIfAborted();
    const record = {
      id: randomUUID(), name, began: performance.now(), ended: null, outcome: "running", traces: [],
    };
    run.history.push(record);
    try {
      const server = await host(run.system);
      const result = await local.run(record, () => server.call(caller, {
        ...operation(name, input, output), arguments: args,
      }, { signal: run.controller.signal }));
      if (result.isError) {
        record.effectOutcome = result._meta?.[errorKey]?.outcome ?? "unknown";
        throw new Error(result._meta?.[errorKey]?.kind ?? "INTERNAL");
      }
      record.outcome = "success";
      return result.structuredContent.result;
    } catch (error) {
      record.outcome = run.controller.signal.aborted ? "cancelled" : "error";
      throw error;
    } finally {
      record.ended = performance.now();
    }
  }

  async function plan(run, source = "auto") {
    const useAi = source === "model" || source === "auto" && systems[run.system].ai && aiMode !== "off";
    if (useAi) {
      const decision = await requestModel({ mode: aiMode, role: "route", task: run.task, signal: run.controller.signal });
      run.decision = { source: aiMode, model: decision.model, mode: decision.mode, tool: decision.tool, callId: decision.callId };
      return { ...empty(run.task), mode: decision.mode };
    }
    const mode = run.task.trim().split(/\s+/).length >= 5 ? "deep" : "brief";
    run.decision = { source: "logic", mode };
    return { ...empty(run.task), mode };
  }

  async function step(run, pending) {
    try {
      await pending();
    } catch (error) {
      if (run.controller.signal.aborted) run.status = "cancelled";
      else {
        run.status = "error";
        run.error = typeof error.message === "string" && /^[A-Z_]+$/.test(error.message)
          ? error.message : "DEMO_EXECUTION_FAILED";
      }
    }
  }

  function createRun(task, system) {
    if (!Object.hasOwn(systems, system) || typeof task !== "string" || !task.trim() || task.length > 1200) {
      throw requestError("Введите задачу от 1 до 1200 символов и выберите систему");
    }
    return {
      id: randomUUID(), task: task.trim(), system, status: "running", controller: new AbortController(),
      history: [], decision: null, intermediate: null, result: null, createdAt: Date.now(), error: null,
    };
  }

  const snapshot = run => ({
    id: run.id, task: run.task, system: run.system, status: run.status, history: structuredClone(run.history),
    decision: run.decision, intermediate: run.intermediate, result: run.result, error: run.error,
    allowModel: systems[run.system].ai && aiMode !== "off",
  });
  function sweep() {
    for (const [id, run] of runs) {
      if (Date.now() - run.createdAt <= expiresAfter) continue;
      run.controller.abort();
      runs.delete(id);
    }
  }
  function owned(owner, id) {
    sweep();
    const run = runs.get(id);
    if (!run || run.owner !== owner) throw requestError("Запуск не найден", 404);
    return run;
  }
  const checkCancelled = run => run.controller.signal.throwIfAborted();
  async function prepare(run) {
    const initial = await plan(run);
    const handlers = { dispatch: args => invoke(run, "dispatch", args, doc, pair) };
    const requestedTool = run.decision.source === "logic" ? "dispatch" : run.decision.tool;
    if (!Object.hasOwn(handlers, requestedTool)) throw new Error("MODEL_TOOL_DENIED");
    const branches = await handlers[requestedTool](initial);
    run.intermediate = await invoke(run, "merge", branches, pair, doc);
    checkCancelled(run);
    run.status = "waiting";
  }

  async function finish(run, { userText, choice }) {
    let output = await invoke(run, choice, { ...run.intermediate, userText, choice });
    const target = run.intermediate.mode === "deep" ? 2 : 1;
    output = await revise(run, output, target);
    const ending = run.system === "baseline" ? ["normalize", "finalize"]
      : run.system === "reconfigured" ? ["decorate", "finalize", "normalize"] : ["finalize"];
    for (const name of ending) output = await invoke(run, name, output);
    checkCancelled(run);
    run.result = output;
    run.status = "done";
  }

  async function revise(run, document, target) {
    for (let count = 0; count < target && document.iteration < target; count++) {
      const previous = document.iteration;
      document = await invoke(run, "revise", document);
      if (document.iteration !== previous + 1) throw new Error("NO_PROGRESS");
    }
    return document;
  }

  async function readForm(system) {
    const pin = config(system).uiPackage;
    // Require the Host to admit the same local package before using its optional UI resource.
    await host(system);
    verifyModuleFiles(pin);
    const client = await connect(new StdioClientTransport({
      command: pin.command, args: pin.args, cwd: pin.root, env: pin.moduleEnvironment, stderr: "ignore",
    }));
    try {
      const listed = await client.listTools();
      const ui = listed.tools.find(tool => tool.name === "merge")?._meta?.ui;
      if (ui?.resourceUri !== resourceUri) throw new Error("Missing UI tool metadata");
      const resource = await client.readResource({ uri: ui.resourceUri });
      const content = resource.contents[0];
      if (resource.contents.length !== 1 || content?.uri !== resourceUri ||
        content.mimeType !== resourceMime || typeof content.text !== "string" || content.text.length > 20_000) {
        throw new Error("Invalid UI resource");
      }
      return content.text;
    } finally {
      await client.close();
    }
  }

  return {
    aiMode,
    start(owner, task, system) {
      sweep();
      if (runs.size >= 100) throw requestError("Слишком много запусков", 429);
      const run = createRun(task, system);
      run.owner = owner;
      runs.set(run.id, run);
      run.pending = step(run, () => prepare(run));
      return snapshot(run);
    },
    list(owner) {
      sweep();
      return [...runs.values()].filter(run => run.owner === owner).map(snapshot).reverse();
    },
    get(owner, id) { return snapshot(owned(owner, id)); },
    resume(owner, id, data) {
      const run = owned(owner, id);
      if (run.status !== "waiting") throw requestError("Этот запуск сейчас нельзя продолжить", 409);
      const { userText, choice } = data;
      if (typeof userText !== "string" || !userText.trim() || userText.length > 500 ||
        !["algorithm", "model"].includes(choice) ||
        choice === "model" && (!systems[run.system].ai || aiMode === "off")) throw requestError("Проверьте ввод и вариант");
      run.status = "running";
      run.pending = step(run, () => finish(run, { userText: userText.trim(), choice }));
      return snapshot(run);
    },
    cancel(owner, id) {
      const run = owned(owner, id);
      if (!["running", "waiting"].includes(run.status)) throw requestError("Запуск уже завершён", 409);
      run.controller.abort();
      run.status = "cancelled";
      return snapshot(run);
    },
    form(owner, id) {
      const run = owned(owner, id);
      if (run.status !== "waiting") throw requestError("Форма доступна во время ожидания", 409);
      if (!forms.has(run.system)) {
        forms.set(run.system, readForm(run.system).catch(error => {
          forms.delete(run.system);
          throw error;
        }));
      }
      return forms.get(run.system);
    },
    async runPattern(name, task, system = "baseline") {
      if (!patterns.includes(name) || name === "wait") throw requestError("Use start/resume for the user pattern");
      const run = createRun(task, system);
      const initial = empty(run.task);
      if (name === "linear") {
        run.result = await invoke(run, "finalize", await invoke(run, "metrics", initial));
      } else if (name === "parallel" || name === "join") {
        const [left, right] = await Promise.all([invoke(run, "metrics", initial), invoke(run, "analysis", initial)]);
        run.result = name === "parallel" ? { left, right } : await invoke(run, "merge", { left, right }, pair, doc);
      } else if (name === "repeat") {
        run.result = await invoke(run, "finalize", await revise(run, initial, 3));
      } else {
        const decisions = await plan(run, name === "ai-routing" ? "model" : "logic");
        const next = decisions.mode === "deep" ? "review" : "metrics";
        run.result = await invoke(run, next, decisions);
      }
      run.status = "done";
      return snapshot(run);
    },
    async cycleProbe(task) {
      const run = createRun(task, "offline");
      return invoke(run, "cycle", empty(run.task));
    },
    async close() {
      closing = true;
      for (const run of runs.values()) run.controller.abort();
      await Promise.allSettled([...runs.values()].map(run => run.pending));
      await Promise.allSettled([...hosts.values()].map(async pending => (await pending).close()));
      await Promise.allSettled(forms.values());
    },
  };
}
