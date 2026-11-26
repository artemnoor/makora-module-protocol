import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { valid } from "semver";
import { type Descriptor, type JsonObject, readProtocolSchema } from "../../sdk/typescript/index.js";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function bound(value: unknown, maxBytes = 64 * 1024) {
  const pending: [unknown, number][] = [[value, 0]];
  let entries = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (depth > 32 || ++entries > 8192) return false;
    if (item && typeof item === "object") {
      if (!Array.isArray(item) && ![null, Object.prototype].includes(Object.getPrototypeOf(item))) return false;
      for (const child of Object.values(item)) pending.push([child, depth + 1]);
    } else if (item !== null && typeof item !== "string" && typeof item !== "boolean" &&
      !(typeof item === "number" && Number.isFinite(item))) {
      return false;
    }
  }
  return Buffer.byteLength(JSON.stringify(value) ?? "") <= maxBytes;
}

export function digest(bytes: string | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export type ContractDefinition = {
  schema: JsonObject;
  semantics: string;
  fixtures: { valid: JsonObject[]; invalid: JsonObject[] };
};
export type ContractPin = { file: string; digest: string };

function localRefs(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["$ref", "$dynamicRef", "$recursiveRef"].includes(key) &&
      (typeof item !== "string" || !item.startsWith("#"))) {
      throw new Error("Contract references must be local fragments");
    }
    localRefs(item);
  }
}

export const validateDescriptor = new Ajv2020().compile<Descriptor>(readProtocolSchema("module-descriptor"));

export class Catalog {
  private readonly entries = new Map<string, { schema: JsonObject; validate: ValidateFunction }>();

  constructor(pins: ContractPin[]) {
    for (const pin of pins) {
      const bytes = readFileSync(pin.file);
      if (digest(bytes) !== pin.digest) throw new Error(`Contract digest mismatch: ${pin.file}`);
      const definition = JSON.parse(bytes.toString("utf8")) as ContractDefinition;
      if (!bound(definition)) throw new Error("Contract file exceeds bounds");
      const { schema, semantics, fixtures } = definition;
      const id = schema.$id;
      if (typeof id !== "string" || !id.startsWith("urn:mmp:") ||
        !valid(id.slice(id.lastIndexOf(":") + 1)) || this.entries.has(id) ||
        schema.type !== "object" || typeof semantics !== "string" || !semantics.trim()) {
        throw new Error(`Invalid or duplicate contract: ${id}`);
      }
      localRefs(schema);
      const validate = new Ajv2020().compile(schema);
      if (!fixtures.valid.length || !fixtures.invalid.length ||
        !fixtures.valid.every(fixture => validate(fixture)) || fixtures.invalid.some(fixture => validate(fixture))) {
        throw new Error(`Contract fixtures failed: ${id}`);
      }
      this.entries.set(id, { schema, validate });
    }
  }

  schema(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown contract: ${id}`);
    return structuredClone(entry.schema);
  }

  accepts(id: string, value: unknown) {
    return bound(value) && Boolean(this.entries.get(id)?.validate(value));
  }
}
