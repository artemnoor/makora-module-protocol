import { readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";

export const revision = "2026-07-28";
export const profile = "0.1.0";
export const extension = "io.github.artemnoor/mmp";
export const contextKey = "io.github.artemnoor/mmp-context";
export const grantKey = "io.github.artemnoor/mmp-grant";
export const errorKey = "io.github.artemnoor/mmp-error";
export type JsonObject = Record<string, unknown>;
export type Triple = { capability: string; inputContract: string; outputContract: string };
export type Invoke = Triple & { arguments: JsonObject; idempotencyKey?: string };
export type Effects = "read-only" | "write" | "external";
export type Idempotency = { mode: "none" | "natural" } | {
  mode: "deduplicated"; retentionSeconds: number; restartPersistent: boolean;
};
export type Operation = Triple & {
  tool: string; permissions: string[]; effects: Effects; execution: "sync"; idempotency: Idempotency;
};
export type Descriptor = {
  id: string; publisher: string; version: string; mmpVersion: typeof profile;
  description: string; requires: Triple[]; operations: Operation[];
};
export type ExecutionContext = {
  correlationId: string; deadline: number; maxDepth: number; chain: string[];
};
export type ErrorKind = "CONTRACT_MISMATCH" | "DEPENDENCY_UNAVAILABLE" | "PERMISSION_DENIED" |
  "DEADLINE_EXCEEDED" | "IDEMPOTENCY_CONFLICT" | "CYCLE_DETECTED" | "MAX_DEPTH_EXCEEDED" |
  "CANCELLED" | "INTERNAL";
export type ErrorOutcome = "not-started" | "failed" | "unknown";

export function readProtocolSchema(name: "module-descriptor" | "invoke" | "error" | "execution-context"): JsonObject {
  return JSON.parse(readFileSync(new URL(`../../../schemas/0.1.0/${name}.schema.json`, import.meta.url), "utf8"));
}

export async function connect(transport: Parameters<Client["connect"]>[0]) {
  const client = new Client({ name: "mmp", version: profile }, {
    versionNegotiation: { mode: { pin: revision } },
  });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

export function gatewayTransport(url: string, credential: string) {
  return new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${credential}` } },
  });
}

export function structured(value: JsonObject) {
  return { structuredContent: value, content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function failure(kind: ErrorKind, correlationId: string, outcome: ErrorOutcome = "not-started") {
  return {
    isError: true as const,
    _meta: { [errorKey]: { kind, message: kind, retryable: false, correlationId, outcome } },
    content: [{ type: "text" as const, text: kind }],
  };
}

export type CallResult = Awaited<ReturnType<Client["callTool"]>>;

export async function invokeGateway(url: string, credential: string, invocation: Invoke, context: string, signal?: AbortSignal) {
  const client = await connect(gatewayTransport(url, credential));
  try {
    return await client.callTool({
      name: "mmp_invoke",
      arguments: invocation,
      _meta: { [contextKey]: context },
    }, { signal });
  } finally {
    await client.close();
  }
}

export type ModuleCall = {
  signal: AbortSignal;
  invoke: (args: Invoke) => Promise<CallResult>;
};
export type BusinessTool = {
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  run: (args: JsonObject, call: ModuleCall) => Promise<CallResult> | CallResult;
};

export function createModule(
  descriptor: Descriptor,
  tools: Record<string, BusinessTool>,
  config: { gateway?: string; credential?: string; hostGrant?: string },
) {
  const server = new McpServer({ name: descriptor.id, version: descriptor.version }, {
    capabilities: { extensions: { [extension]: { descriptor } } },
  });
  for (const op of descriptor.operations) {
    const tool = tools[op.tool];
    if (!tool) throw new Error(`Missing handler for ${op.tool}`);
    server.registerTool(op.tool, {
      inputSchema: fromJsonSchema(tool.inputSchema),
      outputSchema: fromJsonSchema(tool.outputSchema),
    }, (args, ctx) => {
      const meta = ctx.mcpReq._meta;
      const context = meta?.[contextKey];
      if ((op.effects !== "read-only" || op.permissions.length || op.idempotency.mode === "deduplicated") &&
        (!config.hostGrant || meta?.[grantKey] !== config.hostGrant)) {
        return failure("PERMISSION_DENIED", "unavailable");
      }
      return tool.run(args as JsonObject, {
        signal: ctx.mcpReq.signal,
        invoke: invocation => {
          if (!config.gateway || !config.credential || typeof context !== "string") {
            return Promise.resolve(failure("PERMISSION_DENIED", "unavailable"));
          }
          return invokeGateway(config.gateway, config.credential, invocation, context, ctx.mcpReq.signal);
        },
      });
    });
  }
  return server;
}
