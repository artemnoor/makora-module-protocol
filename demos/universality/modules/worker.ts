import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createModule, extension, failure, structured,
  type BusinessTool, type CallResult, type Descriptor, type JsonObject, type ModuleCall,
} from "../../../sdk/typescript/index.js";

const role = process.argv[2] ?? "";
const config = JSON.parse(process.env.MMP_DEMO_DESCRIPTOR ?? "null") as Descriptor | null;
if (!config || !role) throw new Error("Missing module configuration");
const root = new URL("../../../../demos/universality/", import.meta.url);
const { requestModel } = await import(new URL("model.mjs", root).href) as {
  requestModel(options: { mode: string; role: string; task: string; extra: string; signal: AbortSignal }):
    Promise<{ text: string; model: string }>;
};
const { panel, resourceUri, resourceMime } = await import(new URL("surface.mjs", root).href) as {
  panel(alternate: boolean): string; resourceUri: string; resourceMime: string;
};
const doc = "urn:mmp:universal:document:1.0.0";
const schema = (id: string): JsonObject =>
  JSON.parse(readFileSync(new URL(`contracts/${id.split(":")[3]}.json`, root), "utf8")).schema;
const mode = process.env.MMP_DEMO_AI ?? "off";
type Document = JsonObject & {
  task: string; mode: "deep" | "brief"; notes: string[]; userText: string; iteration: number;
};
const add = (value: Document, note: string) => structured({ ...value, notes: [...value.notes, note.slice(0, 800)] });
const resultOf = (result: CallResult) => (result.structuredContent as { result: Document }).result;
const request = (name: string, args: JsonObject) => ({
  capability: `org.example/universal.${name}`, inputContract: doc, outputContract: doc, arguments: args,
});

async function explain(data: Document, signal: AbortSignal) {
  const answer = await requestModel({ mode, role: "work", task: data.task, extra: data.userText, signal });
  return add(data, `[${mode} · ${answer.model}] ${answer.text}`);
}

async function dispatch(data: Document, call: ModuleCall) {
  const strategy = process.env.MMP_DEMO_ROUTING === "logic"
    ? (data.task.trim().split(/\s+/).length >= 5 ? "deep" : "brief") : data.mode;
  const branchData = { ...data, mode: strategy };
  const results = await Promise.all([
    call.invoke(request("metrics", branchData)),
    call.invoke(request("analysis", branchData)),
  ]);
  const failed = results.find(result => result.isError);
  if (failed) return failed;
  const [left, right] = results.map(resultOf);
  if (!left || !right) throw new Error("Branch result unavailable");
  if (strategy === "deep") {
    const checked = await call.invoke(request("review", right));
    return checked.isError ? checked : structured({ left, right: resultOf(checked) });
  }
  return structured({ left, right });
}

const handlers: Record<string, (data: Document, call: ModuleCall) => CallResult | Promise<CallResult>> = {
  dispatch,
  async metrics(data, call) {
    if (process.env.MMP_DEMO_DELAY) await setTimeout(Number(process.env.MMP_DEMO_DELAY), undefined, { signal: call.signal });
    const words = data.task.trim().split(/\s+/).length;
    return add(data, `Метрики: ${words} слов, ${[...data.task].length} символов`);
  },
  async analysis(data, call) {
    if (process.env.MMP_DEMO_DELAY) await setTimeout(Number(process.env.MMP_DEMO_DELAY), undefined, { signal: call.signal });
    return explain(data, call.signal);
  },
  local_analysis(data) {
    return add(data, `Локальный анализ: ${new Set(data.task.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)).size} разных слов`);
  },
  review(data) { return add(data, "Проверена углублённая ветка"); },
  algorithm(data) {
    const tokens = (data.userText.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).sort();
    return add(data, `Алгоритм: ${[...new Set(tokens)].join(", ")}`);
  },
  model(data, call) { return explain(data, call.signal); },
  revise(data) { return add({ ...data, iteration: data.iteration + 1 }, `Повтор ${data.iteration + 1}`); },
  normalize(data) { return structured({ ...data, notes: [...new Set(data.notes.map(note => note.trim()))] }); },
  finalize(data) { return add(data, `Итог для задачи «${data.task.slice(0, 300)}»`); },
  cycle(data, call) { return call.invoke(request("cycle", data)); },
};

if (role === "merge" || role === "merge-alt") {
  const operation = config.operations[0]!;
  const server = new McpServer({ name: config.id, version: config.version }, {
    capabilities: { extensions: { [extension]: { descriptor: config } } },
  });
  server.registerResource("Continuation form", resourceUri, { mimeType: resourceMime }, uri => ({
    contents: [{ uri: uri.toString(), mimeType: resourceMime, text: panel(role === "merge-alt") }],
  }));
  server.registerTool(operation.tool, {
    inputSchema: fromJsonSchema(schema(operation.inputContract)),
    outputSchema: fromJsonSchema(schema(operation.outputContract)),
    _meta: { ui: { resourceUri } },
  }, args => {
    const { left, right } = args as { left: Document; right: Document };
    if (left.task !== right.task) return failure("CONTRACT_MISMATCH", "unavailable");
    return structured({ ...left, notes: [...new Set([...left.notes, ...right.notes])] });
  });
  serveStdio(() => server);
} else {
  const tools: Record<string, BusinessTool> = {};
  for (const operation of config.operations) {
    const handler = handlers[operation.tool];
    if (!handler) throw new Error("Unknown operation");
    tools[operation.tool] = {
      inputSchema: schema(operation.inputContract), outputSchema: schema(operation.outputContract),
      run: (args, call) => handler(args as Document, call),
    };
  }
  serveStdio(() => createModule(config, tools, {
    gateway: process.env.MMP_GATEWAY, credential: process.env.MMP_CREDENTIAL, hostGrant: process.env.MMP_HOST_GRANT,
  }));
}
