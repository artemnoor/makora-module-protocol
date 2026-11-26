import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import { Ajv2020 } from "ajv/dist/2020.js";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import {
  contextKey, errorKey, failure, grantKey, profile, readProtocolSchema, structured,
  type CallResult, type Effects, type ErrorKind, type ExecutionContext, type Invoke, type Triple,
} from "../../sdk/typescript/index.js";
import { bound, canonical, Catalog, type ContractPin } from "./catalog.js";
import { admit, type PackagePin, type Provider, type RegisteredModule, sameContract } from "./registry.js";

export type Grant = {
  caller: string; target: string; tool: string; effects: Effects; permissions: string[];
};
export type HostConfig = {
  catalog: ContractPin[];
  packages: PackagePin[];
  grants: Grant[];
  knownPermissions: string[];
  maxDepth?: number;
  maxDurationMs?: number;
  trace?: (event: {
    correlationId: string; chain: string[]; caller: string; target: string; latencyMs: number;
  }) => void;
};
type Active = ExecutionContext & {
  identity: string;
  routes: ReadonlyMap<string, Provider>;
  signal: AbortSignal;
};
type DedupEntry = { fingerprint: string; expires: number; pending: Promise<CallResult> };
const invokeSchema = readProtocolSchema("invoke");
const ajv = new Ajv2020();
const validateInvoke = ajv.compile<Invoke>(invokeSchema);
const validateError = ajv.compile(readProtocolSchema("error"));

function routeKey(query: Triple) {
  return canonical([query.capability, query.inputContract, query.outputContract]);
}

export async function startHost(config: HostConfig) {
  const catalog = new Catalog(config.catalog);
  const knownPermissions = new Set(config.knownPermissions);
  const maxDepth = config.maxDepth ?? 8;
  const durationLimit = config.maxDurationMs ?? 10_000;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 64 ||
    !Number.isSafeInteger(durationLimit) || durationLimit < 1 || durationLimit > 600_000) {
    throw new Error("Invalid Host execution limits");
  }
  const modules = new Map<string, RegisteredModule>();
  const credentials = new Map<string, string>();
  const hostGrants = new Map<string, string>();
  const active = new Map<string, Active>();
  const routes = new Map<string, Provider>();
  const dedup = new Map<string, DedupEntry>();
  const pins = new Map<string, string>();
  let closed = false;

  function permits(caller: string, { module, operation }: Provider) {
    return config.grants.some(grant => grant.caller === caller && grant.target === module.descriptor.id &&
      grant.tool === operation.tool && grant.effects === operation.effects &&
      operation.permissions.every(permission => grant.permissions.includes(permission)));
  }

  async function dispatch(provider: Provider, args: Invoke, parent: Active, signal: AbortSignal): Promise<CallResult> {
    const { module, operation } = provider;
    const identity = module.descriptor.id;
    const token = randomUUID();
    const lifetime = new AbortController();
    const callSignal = AbortSignal.any([signal, lifetime.signal]);
    active.set(token, { ...parent, identity, signal: callSignal, chain: [...parent.chain, args.capability] });
    try {
      signal.throwIfAborted();
      const result = await module.client.callTool({
        name: operation.tool, arguments: args.arguments,
        _meta: { [contextKey]: token, [grantKey]: hostGrants.get(identity) },
      }, { signal: callSignal });
      if (result.isError) {
        const reported = result._meta?.[errorKey];
        if (!bound(reported) || !validateError(reported)) return failure("INTERNAL", parent.correlationId, "unknown");
        const details = reported as { kind: ErrorKind; outcome: "not-started" | "failed" | "unknown" };
        return failure(details.kind, parent.correlationId, details.outcome);
      }
      if (!catalog.accepts(operation.outputContract, result.structuredContent)) {
        return failure("CONTRACT_MISMATCH", parent.correlationId, "unknown");
      }
      return structured({ outputContract: operation.outputContract, result: result.structuredContent });
    } catch {
      const kind = Date.now() >= parent.deadline ? "DEADLINE_EXCEEDED" : signal.aborted ? "CANCELLED" : "INTERNAL";
      return failure(kind, parent.correlationId, "unknown");
    } finally {
      active.delete(token);
      lifetime.abort();
    }
  }

  async function route(
    caller: string, invocation: Invoke, parent: Active, signal: AbortSignal,
  ): Promise<CallResult> {
    const reject = (kind: ErrorKind) => failure(kind, parent.correlationId);
    if (!bound(invocation) || !validateInvoke(invocation)) return reject("CONTRACT_MISMATCH");
    if (signal.aborted) return reject("CANCELLED");
    const remaining = parent.deadline - Date.now();
    if (remaining <= 0) return reject("DEADLINE_EXCEEDED");
    if (parent.chain.includes(invocation.capability)) return reject("CYCLE_DETECTED");
    if (parent.chain.length >= parent.maxDepth) return reject("MAX_DEPTH_EXCEEDED");
    const key = routeKey(invocation);
    const provider = parent.routes.get(key);
    if (!provider) return reject([...parent.routes.values()].some(entry => entry.operation.capability === invocation.capability)
      ? "CONTRACT_MISMATCH" : "DEPENDENCY_UNAVAILABLE");
    if (!permits(caller, provider)) return reject("PERMISSION_DENIED");
    if (!catalog.accepts(invocation.inputContract, invocation.arguments)) return reject("CONTRACT_MISMATCH");
    const deadlineSignal = AbortSignal.timeout(remaining);
    const childSignal = AbortSignal.any([signal, parent.signal, deadlineSignal]);
    const idempotency = provider.operation.idempotency;
    const started = performance.now();
    const run = () => dispatch(provider, invocation, parent, childSignal);
    const identity = provider.module.descriptor;
    const target = canonical([identity.id, identity.version, provider.operation.tool]);
    try {
      const idempotencyKey = invocation.idempotencyKey;
      if (!idempotencyKey) {
        return idempotency.mode === "deduplicated" ? reject("IDEMPOTENCY_CONFLICT") : await run();
      }
      const now = Date.now();
      for (const [entryKey, entry] of dedup) {
        if (entry.expires <= now) {
          dedup.delete(entryKey);
          pins.delete(entryKey);
        }
      }
      const scope = canonical([caller, invocation.capability, invocation.inputContract, invocation.outputContract, idempotencyKey]);
      if (pins.has(scope) && pins.get(scope) !== target) return reject("IDEMPOTENCY_CONFLICT");
      if (idempotency.mode !== "deduplicated") return await run();
      const fingerprint = canonical(invocation.arguments);
      const previous = dedup.get(scope);
      if (previous && previous.fingerprint !== fingerprint) return reject("IDEMPOTENCY_CONFLICT");
      if (!previous && dedup.size >= 10_000) return reject("INTERNAL");
      let record = previous;
      if (!record) {
        record = { fingerprint, expires: Infinity, pending: run() };
        dedup.set(scope, record);
        pins.set(scope, target);
        const fresh = record;
        void fresh.pending.then(() => { fresh.expires = Date.now() + idempotency.retentionSeconds * 1000; });
      }
      const result = await waitFor(record.pending, childSignal);
      if (!result) {
        return failure(deadlineSignal.aborted || Date.now() >= parent.deadline ? "DEADLINE_EXCEEDED" : "CANCELLED",
          parent.correlationId, "unknown");
      }
      if (!result.isError) return result;
      const retained = result._meta?.[errorKey] as { kind: ErrorKind; outcome: "not-started" | "failed" | "unknown" };
      return failure(retained.kind, parent.correlationId, retained.outcome);
    } finally {
      config.trace?.({
        correlationId: parent.correlationId, chain: [...parent.chain, invocation.capability],
        caller, target: provider.module.descriptor.id, latencyMs: performance.now() - started,
      });
    }
  }

  const mcpHandler = createMcpHandler(() => {
    const server = new McpServer({ name: "mmp-gateway", version: profile });
    server.registerTool("mmp_invoke", {
      inputSchema: fromJsonSchema(invokeSchema),
      outputSchema: z.object({ outputContract: z.string(), result: z.unknown() }),
    }, async (args, ctx) => {
      const token = ctx.mcpReq._meta?.[contextKey];
      const caller = ctx.http?.authInfo?.clientId;
      const parent = typeof token === "string" ? active.get(token) : undefined;
      if (!caller || parent?.identity !== caller) return failure("PERMISSION_DENIED", randomUUID());
      const invocation = args as Invoke;
      if (!modules.get(caller)?.descriptor.requires.some(requirement => sameContract(invocation, requirement))) {
        return failure("PERMISSION_DENIED", parent.correlationId);
      }
      return route(caller, invocation, parent, ctx.mcpReq.signal);
    });
    return server;
  }, { legacy: "reject" });
  const mcpHttp = toNodeHandler(mcpHandler, { maxRequestBodySize: 64 * 1024 });
  const http = createServer((req: IncomingMessage & { auth?: { token: string; clientId: string; scopes: string[] } }, res) => {
    const endpoint = http.address();
    const authority = endpoint && typeof endpoint !== "string" ? `127.0.0.1:${endpoint.port}` : "";
    if (req.headers.host !== authority ||
      (req.headers.origin !== undefined && req.headers.origin !== `http://${authority}`)) {
      res.writeHead(403).end();
      return;
    }
    if (req.url !== "/mcp") return res.writeHead(404).end();
    const credential = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const caller = credential && credentials.get(credential);
    if (!credential || !caller) return res.writeHead(401, { "www-authenticate": "Bearer" }).end();
    req.auth = { token: credential, clientId: caller, scopes: [] };
    void mcpHttp(req, res);
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback TCP address");
  const gateway = `http://127.0.0.1:${address.port}/mcp`;

  async function close() {
    if (closed) return;
    closed = true;
    credentials.clear();
    await Promise.allSettled([...modules.values()].map(module => module.client.close()));
    await mcpHandler.close();
    http.closeAllConnections();
    await new Promise<void>(resolve => http.close(() => resolve()));
    active.clear();
    dedup.clear();
    pins.clear();
  }
  try {
    for (const pin of config.packages) {
      if (modules.has(pin.id)) throw new Error(`Duplicate module: ${pin.id}`);
      const credential = randomUUID();
      const grant = randomUUID();
      credentials.set(credential, pin.id);
      hostGrants.set(pin.id, grant);
      const module = await admit(pin, catalog, knownPermissions, {
        MMP_GATEWAY: gateway, MMP_CREDENTIAL: credential, MMP_HOST_GRANT: grant,
      });
      modules.set(pin.id, module);
      for (const operation of module.descriptor.operations) {
        const key = routeKey(operation);
        if (!routes.has(key)) routes.set(key, { module, operation });
      }
    }
  } catch (error) {
    await close();
    throw error;
  }

  return {
    gateway,
    close,
    select(query: Triple, id: string) {
      const module = modules.get(id);
      const operation = module?.descriptor.operations.find(op => sameContract(query, op));
      if (!module || !operation) throw new Error("Provider does not implement the exact contract");
      routes.set(routeKey(query), { module, operation });
    },
    async call(caller: string, invocation: Invoke, options: { deadline?: number; signal?: AbortSignal } = {}) {
      const correlationId = randomUUID();
      if (options.deadline !== undefined && (!Number.isSafeInteger(options.deadline) || options.deadline < 0)) {
        return failure("CONTRACT_MISMATCH", correlationId);
      }
      const deadline = Math.min(options.deadline ?? Infinity, Date.now() + durationLimit);
      const signal = options.signal ?? new AbortController().signal;
      const parent = { identity: caller, deadline, correlationId, maxDepth, chain: [], routes: new Map(routes), signal };
      if (closed) return failure("DEPENDENCY_UNAVAILABLE", parent.correlationId);
      // Module identities are derived from Gateway authentication only.
      if (!caller.startsWith("host:") || modules.has(caller)) return failure("PERMISSION_DENIED", parent.correlationId);
      return route(caller, invocation, parent, signal);
    },
  };
}

async function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return undefined;
  let abort: () => void = () => {};
  const aborted = new Promise<undefined>(resolve => {
    abort = () => resolve(undefined);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
