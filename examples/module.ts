import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createModule, structured, type BusinessTool, type CallResult, type Descriptor, type JsonObject, type Triple } from "../sdk/typescript/index.js";

const role = process.argv[2];
if (!role || !["coordinator", "research", "reviewer", "ledger", "adapter"].includes(role)) {
  throw new Error("Expected a supported example module name");
}
const root = new URL("../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const descriptor = read(`examples/descriptors/${role}.json`) as Descriptor;
const schema = (id: string): JsonObject => read(`contracts/${id.split(":")[3]}.json`).schema;
const contract = (name: string) => `urn:mmp:example:${name}:1.0.0`;
const target = (capability: string, input: string, output: string): Triple => ({
  capability: `org.example/${capability}`, inputContract: contract(input), outputContract: contract(output),
});
const unwrap = (result: CallResult) => (result.structuredContent as { result: JsonObject }).result;
let sequence = 0;

type GenerateFindings = (topic: string, signal: AbortSignal) => Promise<string[]>;

function createFindingsGenerator(endpoint: string | undefined): GenerateFindings {
  if (!endpoint) return async topic => [`typescript: ${topic}`];
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && (url.protocol !== "http:" || url.hostname !== "127.0.0.1")) {
    throw new Error("Research provider requires HTTPS or loopback HTTP");
  }
  return async (topic, signal) => {
    const response = await fetch(url, {
      method: "POST", redirect: "error", headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic }), signal,
    });
    if (!response.ok) throw new Error("Research provider request failed");
    const result: unknown = await response.json();
    const findings = (result as { findings?: unknown } | null)?.findings;
    if (!Array.isArray(findings) || findings.length < 1 || findings.length > 8 ||
      !findings.every(item => typeof item === "string" && item.length >= 1 && item.length <= 1000)) {
      throw new Error("Research provider returned an invalid report");
    }
    return findings;
  };
}
const generateFindings = createFindingsGenerator(process.env.MMP_RESEARCH_PROVIDER);

const handlers: Record<string, BusinessTool["run"]> = {
  async research(args, call) {
    if (args.waitMs) await setTimeout(Number(args.waitMs), undefined, { signal: call.signal });
    return structured({ findings: await generateFindings(String(args.topic), call.signal) });
  },
  review(args) {
    return structured({ findings: [`reviewed ${args.topic}`, ...(args.findings as string[])] });
  },
  async coordinate(args, call) {
    const [primary, secondary] = await Promise.all([
      call.invoke({ ...target("research", "task", "report"), arguments: args }),
      call.invoke({ ...target("secondary", "task", "report"), arguments: args }),
    ]);
    if (primary.isError) return primary;
    if (secondary.isError) return secondary;
    const findings = [primary, secondary].flatMap(result => unwrap(result).findings as string[]);
    const plan = await call.invoke({
      ...target("plan", "plan", "report"), arguments: { topic: args.topic, findings },
    });
    return plan.isError ? plan : structured(unwrap(plan));
  },
  cycle: (args, call) => call.invoke({ ...target("cycle", "task", "report"), arguments: args }),
  async record(args, call) {
    await setTimeout(Number(args.waitMs ?? 0), undefined, { signal: call.signal });
    return structured({ sequence: ++sequence, text: args.topic });
  },
  async recordNested(args, call) {
    const result = await call.invoke({
      ...target("record", "task", "receipt"), arguments: args, idempotencyKey: String(args.topic),
    });
    return result.isError ? result : structured(unwrap(result));
  },
  asKopecks(args) {
    return structured({ amount: Number(args.amount) * 100, currency: "RUB", unit: "minor" });
  },
  takeKopecks: structured,
};
const tools = Object.fromEntries(descriptor.operations.map(op => {
  const run = handlers[op.tool];
  if (!run) throw new Error(`Missing example implementation: ${op.tool}`);
  return [op.tool, { inputSchema: schema(op.inputContract), outputSchema: schema(op.outputContract), run }];
}));

serveStdio(() => createModule(descriptor, tools, {
  gateway: process.env.MMP_GATEWAY,
  credential: process.env.MMP_CREDENTIAL,
  hostGrant: process.env.MMP_HOST_GRANT,
}));
