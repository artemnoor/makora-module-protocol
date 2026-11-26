import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { callContext, connect, failure, report, structured, task } from "./mcp.mjs";

const request = z.strictObject({
  capability: z.string(),
  inputContract: z.string(),
  outputContract: z.string(),
  arguments: z.strictObject({ topic: z.string(), waitMs: z.number().int().nonnegative().optional() }),
});

export async function startHost() {
  const processes = new Map();
  const credentials = new Map();
  const grants = new Map();
  const active = new Map();
  const routes = new Map([
    ["org.example/research", ["python", "report"]],
    ["org.example/report", ["typescript", "report"]],
    ["org.example/reenter", ["typescript", "delegate"]],
    ["org.example/protected", ["typescript", "protected"]],
  ]);
  const allowed = new Map([
    ["typescript", new Set(["org.example/research", "org.example/reenter"])],
    ["python", new Set(["org.example/report"])],
  ]);
  const trace = [];
  const cancelledHandlers = [];
  let depthLimit = 4;

  async function dispatch(id, tool, args, parent, capability, signal) {
    const token = randomUUID();
    const state = { ...parent, id, stack: [...parent.stack, capability], signal };
    active.set(token, state);
    try {
      return await processes.get(id).callTool({
        name: tool,
        arguments: args,
        _meta: { [callContext]: token, "org.example/mmp-grant": grants.get(id) },
      }, { signal });
    } finally {
      active.delete(token);
    }
  }

  const handler = createMcpHandler(() => {
    const gateway = new McpServer({ name: "spike-gateway", version: "0.1.0" });
    gateway.registerTool("mmp_invoke", {
      inputSchema: request,
      outputSchema: z.object({ outputContract: z.string(), result: z.unknown() }),
    }, async (args, ctx) => {
      const started = performance.now();
      const { _meta, signal } = ctx.mcpReq;
      const caller = ctx.http?.authInfo?.clientId;
      const parent = active.get(_meta?.[callContext]);
      const correlationId = parent?.correlationId ?? randomUUID();
      if (!parent || parent.id !== caller || !allowed.get(caller)?.has(args.capability)) {
        return failure("PERMISSION_DENIED", correlationId);
      }
      if (parent.stack.includes(args.capability)) return failure("CYCLE_DETECTED", correlationId);
      if (parent.stack.length >= depthLimit) return failure("MAX_DEPTH_EXCEEDED", correlationId);
      if (args.inputContract !== task || args.outputContract !== report) {
        return failure("CONTRACT_MISMATCH", correlationId);
      }
      const route = routes.get(args.capability);
      if (!route) return failure("DEPENDENCY_UNAVAILABLE", correlationId);
      const remaining = parent.deadline - Date.now();
      if (remaining <= 0) return failure("DEADLINE_EXCEEDED", correlationId);
      const deadlineSignal = AbortSignal.timeout(remaining);
      const childSignal = AbortSignal.any([signal, parent.signal, deadlineSignal]);
      const [target, tool] = route;
      const event = { correlationId, caller, target, capability: args.capability, chain: parent.stack };
      trace.push({ ...event, phase: "start" });
      try {
        const result = await dispatch(target, tool, args.arguments, parent, args.capability, childSignal);
        if (result.isError) return result;
        return structured({ outputContract: report, result: result.structuredContent });
      } catch {
        const kind = deadlineSignal.aborted || Date.now() >= parent.deadline
          ? "DEADLINE_EXCEEDED" : childSignal.aborted ? "CANCELLED" : "INTERNAL";
        trace.push({ ...event, phase: "interrupted", kind, outcome: "unknown" });
        return failure(kind, correlationId, "unknown");
      } finally {
        trace.push({ ...event, phase: "finish", latencyMs: performance.now() - started });
      }
    });
    return gateway;
  }, { legacy: "reject" });

  const httpMcp = toNodeHandler(handler, { maxRequestBodySize: 64 * 1024 });
  const listener = createServer((req, res) => {
    if (req.url !== "/mcp") return res.writeHead(404).end();
    const credential = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const id = credentials.get(credential);
    if (!id) return res.writeHead(401, { "www-authenticate": "Bearer" }).end();
    req.auth = { clientId: id, token: credential, scopes: [] };
    void httpMcp(req, res);
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const url = `http://127.0.0.1:${listener.address().port}/mcp`;
  async function close() {
    await Promise.allSettled([...processes.values()].map(client => client.close()));
    await handler.close();
    listener.closeAllConnections();
    await new Promise(resolve => listener.close(resolve));
  }
  try {
    for (const id of ["typescript", "python", "alternate"]) {
      const credential = randomUUID();
      const grant = randomUUID();
      credentials.set(credential, id);
      grants.set(id, grant);
      const python = id === "python";
      const executable = process.platform === "win32"
        ? join(".venv", "Scripts", "python.exe") : join(".venv", "bin", "python");
      const transport = new StdioClientTransport({
        command: python ? executable : process.execPath,
        args: [python ? "module.py" : "module.mjs"],
        env: { MMP_MODULE: id, MMP_CREDENTIAL: credential, MMP_GATEWAY: url, MMP_HOST_GRANT: grant },
        stderr: "pipe",
      });
      let stderr = "";
      transport.stderr?.on("data", chunk => {
        stderr += chunk.toString();
        const lines = stderr.split(/\r?\n/);
        stderr = lines.pop();
        for (const line of lines) {
          if (line === "mmp-spike: handler cancelled") cancelledHandlers.push(id);
        }
      });
      processes.set(id, await connect(transport));
    }
  } catch (error) {
    await close();
    throw error;
  }

  return {
    trace, url, close, processes, cancelledHandlers,
    setDepth: limit => { depthLimit = limit; },
    route: (capability, target, tool) => routes.set(capability, [target, tool]),
    credential: id => [...credentials].find(([, value]) => value === id)?.[0],
    activeContext: id => [...active].find(([, state]) => state.id === id)?.[0],
    async call(id, tool, args, { budget = 3000, abort, capability = tool } = {}) {
      const parent = { correlationId: randomUUID(), deadline: Date.now() + budget, stack: [] };
      const timer = AbortSignal.timeout(budget);
      try {
        return await dispatch(id, tool, args, parent, capability, abort ? AbortSignal.any([timer, abort]) : timer);
      } catch (error) {
        if (timer.aborted) return failure("DEADLINE_EXCEEDED", parent.correlationId, "unknown");
        if (abort?.aborted) return failure("CANCELLED", parent.correlationId, "unknown");
        throw error;
      }
    },
  };
}
