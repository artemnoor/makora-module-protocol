const node = id => document.getElementById(id);
const statuses = {
  running: "Выполняется", waiting: "Ожидает ввода", done: "Завершено", error: "Ошибка", cancelled: "Отменено",
};
const names = {
  dispatch: "Распределение", metrics: "Метрики", analysis: "Анализ", review: "Проверка",
  merge: "Объединение", algorithm: "Алгоритм", model: "Модель", revise: "Повтор",
  normalize: "Нормализация", finalize: "Итог", decorate: "Дополнение",
};
const labels = { off: "AI отключён", fixture: "Контрольный AI", live: "Живые модели" };
const frame = node("module-ui");
const runPicker = node("run");
const all = new Map();
let current = new URL(location.href).searchParams.get("run");
let latest;
let polling;
let submitting = false;

async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error);
  return json;
}

function message(text) {
  node("message").textContent = text;
  node("message").hidden = !text;
}
function item(text, element = "li") {
  const result = document.createElement(element);
  result.textContent = text;
  return result;
}
function output(id, documentValue) {
  const box = node(id);
  box.hidden = !documentValue;
  box.querySelector("ul").replaceChildren(...(documentValue?.notes ?? []).map(note => item(note)));
}
function phases(events) {
  const groups = [];
  for (const event of events.toSorted((a, b) => (a.ended - a.latencyMs) - (b.ended - b.latencyMs))) {
    const group = groups.at(-1);
    if (group && event.ended - event.latencyMs < group.end) {
      group.events.push(event);
      group.end = Math.max(group.end, event.ended);
    } else {
      groups.push({ end: event.ended, events: [event] });
    }
  }
  return groups;
}
function traces(history) {
  const graph = node("graph");
  const events = node("history");
  graph.replaceChildren();
  events.replaceChildren();
  node("trace-empty").hidden = history.length > 0;
  for (const call of history) {
    const group = document.createElement("li");
    const title = item(names[call.name] ?? call.name, "span");
    title.className = "node-name";
    group.append(title);
    const root = call.traces.find(trace => trace.chain.length === 1);
    if (root) events.append(item(`${root.target} · ${Math.round(root.latencyMs)} мс · ${root.correlationId.slice(0, 8)}`));
    else events.append(item(`${names[call.name] ?? call.name} · ${call.outcome}`));
    const nested = call.traces.filter(trace => trace.chain.length > 1);
    for (const [index, phase] of phases(nested).entries()) {
      if (index > 0 || phase.events.length > 1) {
        const label = item(phase.events.length > 1 ? "Параллельно" : "Затем", "span");
        label.className = "phase-label";
        group.append(label);
      }
      const children = document.createElement("ul");
      for (const event of phase.events) {
        const chain = event.chain.slice(1).map(cap => cap.split(".").at(-1)).map(name => names[name] ?? name);
        children.append(item(chain.join(" → ")));
      }
      group.append(children);
    }
    for (const event of nested) events.append(item(`${event.target} · ${Math.round(event.latencyMs)} мс · ${event.correlationId.slice(0, 8)}`));
    graph.append(group);
  }
}

function render(run) {
  latest = run;
  const state = node("status");
  const statusText = statuses[run?.status] ?? "Нет запуска";
  if (state.textContent !== statusText) state.replaceChildren(item(statusText, "span"));
  state.dataset.state = run?.status ?? "";
  const pending = run?.status === "waiting";
  frame.hidden = !pending;
  if (pending) {
    const src = `/api/runs/${run.id}/ui`;
    if (frame.getAttribute("src") !== src) frame.setAttribute("src", src);
  } else if (frame.hasAttribute("src")) frame.removeAttribute("src");
  node("cancel").hidden = !["running", "waiting"].includes(run?.status);
  node("decision").hidden = !run?.decision;
  if (run?.decision) {
    const { source, model, mode } = run.decision;
    node("decision").textContent = `${labels[source] ?? "Правило приложения"}${model ? ` · ${model}` : ""} · ${mode === "deep" ? "углублённый маршрут" : "краткий маршрут"}`;
  }
  if (run?.error) message(`Выполнение прервано (${run.error}).`);
  output("intermediate", run?.intermediate);
  output("result", run?.result);
  traces(run?.history ?? []);
}

function addRun(run) {
  if (all.has(run.id)) return;
  all.set(run.id, run);
  const option = item(run.task.slice(0, 74), "option");
  option.value = run.id;
  if (runPicker.disabled) runPicker.replaceChildren(option);
  else runPicker.prepend(option);
  runPicker.disabled = false;
}

function select(id) {
  current = id;
  runPicker.value = id ?? "";
  const address = new URL(location.href);
  if (id) address.searchParams.set("run", id);
  else address.searchParams.delete("run");
  history.replaceState(null, "", address);
  clearTimeout(polling);
}

async function refresh(id) {
  if (id !== current) return;
  try {
    const run = await api(`/api/runs/${id}`);
    if (id !== current) return;
    render(run);
    if (run.status === "running") polling = setTimeout(() => { void refresh(id); }, 170);
  } catch (error) {
    if (id === current) message(error.message);
  }
}

node("start").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  message("");
  try {
    const inputs = Object.fromEntries(new FormData(event.target));
    const run = await api("/api/runs", inputs);
    addRun(run);
    select(run.id);
    render(run);
    void refresh(run.id);
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
});
runPicker.addEventListener("change", () => {
  message("");
  select(runPicker.value);
  render();
  void refresh(current);
});
frame.addEventListener("load", () => {
  if (latest?.status === "waiting") {
    frame.contentWindow.postMessage({ type: "mmp-demo/ui-config", allowModel: latest.allowModel }, "*");
  }
});
addEventListener("message", async event => {
  if (!current || latest?.id !== current || latest.status !== "waiting" || submitting ||
    event.source !== frame.contentWindow || event.origin !== "null" || event.data?.type !== "mmp-demo/continue") return;
  const id = current;
  submitting = true;
  message("");
  try {
    const { choice, userText } = event.data;
    const run = await api(`/api/runs/${id}/resume`, { choice, userText });
    if (current === id) {
      render(run);
      void refresh(id);
    }
  } catch (error) {
    if (current === id) message(error.message);
  } finally {
    submitting = false;
  }
});
node("cancel").addEventListener("click", async () => {
  const id = current;
  try {
    const run = await api(`/api/runs/${id}/cancel`, {});
    if (current === id) {
      clearTimeout(polling);
      render(run);
    }
  } catch (error) {
    if (current === id) message(error.message);
  }
});

try {
  const state = await api("/api");
  node("ai-mode").textContent = labels[state.aiMode] ?? "";
  for (const [id, system] of Object.entries(state.systems)) {
    const option = item(system.title, "option");
    option.value = id;
    node("system").append(option);
  }
  for (const run of state.runs.slice().reverse()) addRun(run);
  select(all.has(current) ? current : state.runs[0]?.id ?? null);
  if (current) void refresh(current);
} catch (error) {
  message(error.message);
}
