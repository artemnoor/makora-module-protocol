import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { valid } from "semver";
import { connect, extension, type Descriptor, type Operation, type Triple } from "../../sdk/typescript/index.js";
import { bound, canonical, digest, validateDescriptor, type Catalog } from "./catalog.js";

export type PackagePin = {
  id: string;
  publisher: string;
  version: string;
  root: string;
  files: Record<string, string>;
  command: string;
  args: string[];
  moduleEnvironment?: Record<string, string>;
};

export type RegisteredModule = {
  descriptor: Descriptor;
  client: Awaited<ReturnType<typeof connect>>;
};

export function verifyPackage(pin: PackagePin) {
  const root = realpathSync(pin.root);
  const entry = pin.args[0];
  if (!isAbsolute(pin.command) || !entry || !Object.hasOwn(pin.files, entry) || valid(pin.version) !== pin.version) {
    throw new Error(`Invalid package pin: ${pin.id}`);
  }
  for (const [file, hash] of Object.entries(pin.files)) {
    const path = resolve(root, file);
    const route = relative(root, path);
    if (!route || route === ".." || route.startsWith("../") || route.startsWith("..\\") ||
      isAbsolute(route) || realpathSync(path) !== path || digest(readFileSync(path)) !== hash) {
      throw new Error(`Module package digest mismatch: ${pin.id}/${file}`);
    }
  }
}

export function sameContract(a: Triple, b: Triple) {
  return a.capability === b.capability && a.inputContract === b.inputContract && a.outputContract === b.outputContract;
}

function validateOperations(descriptor: Descriptor, catalog: Catalog, knownPermissions: ReadonlySet<string>) {
  const tools = new Set<string>();
  const triples = new Set<string>();
  for (const item of descriptor.requires) {
    catalog.schema(item.inputContract);
    catalog.schema(item.outputContract);
  }
  for (const op of descriptor.operations) {
    const triple = canonical([op.capability, op.inputContract, op.outputContract]);
    if (tools.has(op.tool) || triples.has(triple) || op.tool.startsWith("mmp_") ||
      op.permissions.some(permission => !knownPermissions.has(permission)) ||
      (op.idempotency.mode === "deduplicated" && op.idempotency.restartPersistent)) {
      throw new Error(`Invalid operation: ${descriptor.id}/${op.tool}`);
    }
    tools.add(op.tool);
    triples.add(triple);
    catalog.schema(op.inputContract);
    catalog.schema(op.outputContract);
  }
}

export async function admit(
  pin: PackagePin,
  catalog: Catalog,
  knownPermissions: ReadonlySet<string>,
  environment: Record<string, string>,
): Promise<RegisteredModule> {
  verifyPackage(pin);
  const client = await connect(new StdioClientTransport({
    command: pin.command, args: pin.args, cwd: pin.root,
    env: { ...pin.moduleEnvironment, ...environment }, stderr: "ignore",
  }));
  try {
    const discovery = await client.discover();
    const descriptor = discovery.capabilities?.extensions?.[extension]?.descriptor;
    if (!bound(descriptor) || !validateDescriptor(descriptor) || descriptor.id !== pin.id ||
      descriptor.publisher !== pin.publisher || descriptor.version !== pin.version) {
      throw new Error(`Invalid module descriptor: ${pin.id}`);
    }
    validateOperations(descriptor, catalog, knownPermissions);
    const listed = new Map<string, Awaited<ReturnType<typeof client.listTools>>["tools"][number]>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of page.tools) {
        if (listed.has(tool.name) || listed.size >= 512) throw new Error("Duplicate or excessive tools");
        listed.set(tool.name, tool);
      }
      cursor = page.nextCursor;
      if (cursor) {
        if (cursors.has(cursor) || cursors.size >= 16) throw new Error("Invalid tools/list pagination");
        cursors.add(cursor);
      }
    } while (cursor);
    if (listed.size !== descriptor.operations.length) throw new Error(`Tool listing mismatch: ${pin.id}`);
    for (const op of descriptor.operations) {
      const tool = listed.get(op.tool);
      if (!tool || !bound(tool) || canonical(tool.inputSchema) !== canonical(catalog.schema(op.inputContract)) ||
        canonical(tool.outputSchema) !== canonical(catalog.schema(op.outputContract))) {
        throw new Error(`Schema mismatch: ${pin.id}/${op.tool}`);
      }
    }
    return { client, descriptor };
  } catch (error) {
    await client.close();
    throw error;
  }
}

export type Provider = { module: RegisteredModule; operation: Operation };
