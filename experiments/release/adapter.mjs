import { readFileSync } from "node:fs";
import { createModule, structured } from "@artemnoor/mmp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")).schema;
const reading = read("contracts/reading.json");
const pair = read("contracts/pair.json");
const task = read("existing/contracts/task.json");
function operation(name, input, output) {
  return {
    capability: `org.independent/${name}`, inputContract: input.$id, outputContract: output.$id,
    tool: name, permissions: [], effects: "read-only", execution: "sync", idempotency: { mode: "natural" },
  };
}
const descriptor = {
  id: "org.independent.adapter", publisher: "org.independent", version: "1.0.0", mmpVersion: "0.1.0",
  description: "Measurement merge and explicit adapter to the research task contract",
  requires: [], operations: [
    operation("merge", pair, reading), operation("to-task", reading, task),
    { ...operation("assist", reading, reading), effects: "external", permissions: ["inference.generate"] },
  ],
};
serveStdio(() => createModule(descriptor, {
  merge: {
    inputSchema: pair, outputSchema: reading,
    run: ({ left, right }) => structured({
      ...left, source: left.source.trim(), notes: [...new Set([...left.notes, ...right.notes])],
    }),
  },
  "to-task": {
    inputSchema: reading, outputSchema: task,
    run: reading => structured({ topic: `${reading.source.trim()}/${reading.severity}` }),
  },
  assist: {
    inputSchema: reading, outputSchema: reading,
    async run(value, { signal }) {
      const response = await fetch(process.env.LAB_INFERENCE_URL, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value), signal,
      });
      if (!response.ok) throw new Error("Inference endpoint failed");
      const { suggestion } = await response.json();
      if (typeof suggestion !== "string" || suggestion.length > 240) throw new Error("Invalid inference response");
      return structured({ ...value, notes: [...value.notes, suggestion] });
    },
  },
}, { hostGrant: process.env.MMP_HOST_GRANT }));
