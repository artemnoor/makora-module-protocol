import { equal, ok } from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const rules = new Map([
  ["sdk/typescript", []],
  ["reference/host", ["sdk/typescript/index.ts"]],
  ["examples", ["sdk/typescript/index.ts"]],
]);
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => {
  const file = resolve(path, entry.name);
  return entry.isDirectory() ? walk(file) : file.endsWith(".ts") ? [file] : [];
});

test("runtime components have one-way imports and public SDK boundaries", () => {
  const graph = new Map();
  for (const [folder, publicImports] of rules) {
    const base = resolve(root, folder);
    for (const file of walk(base)) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
      const dependencies = [];
      graph.set(file, dependencies);
      const check = node => {
        const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
        if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
          const target = resolve(dirname(file), specifier.text.replace(/\.js$/, ".ts"));
          ok(target.startsWith(base + (process.platform === "win32" ? "\\" : "/")) ||
            publicImports.some(path => resolve(root, path) === target),
          `Invalid dependency ${file} -> ${target}`);
          dependencies.push(target);
        }
        ts.forEachChild(node, check);
      };
      check(source);
    }
  }
  const completed = new Set();
  const active = new Set();
  function visit(file) {
    if (completed.has(file)) return;
    ok(!active.has(file), `Import cycle through ${file}`);
    active.add(file);
    for (const target of graph.get(file) ?? []) visit(target);
    active.delete(file);
    completed.add(file);
  }
  for (const file of graph.keys()) visit(file);
});

test("protocol artifacts and composition roots exist at their public paths", () => {
  for (const file of [
    "sdk/typescript/index.ts", "reference/host/index.ts", "examples/module.py",
    "schemas/0.1.0/module-descriptor.schema.json", "schemas/0.1.0/invoke.schema.json",
    "schemas/0.1.0/execution-context.schema.json", "schemas/0.1.0/error.schema.json",
  ]) equal(statSync(resolve(root, file)).isFile(), true, file);
});
