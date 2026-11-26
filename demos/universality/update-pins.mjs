import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const files = [
  "dist/demos/universality/modules/worker.js",
  "dist/sdk/typescript/index.js",
  "demos/universality/contracts/document.json",
  "demos/universality/contracts/pair.json",
  "demos/universality/model.mjs",
  "demos/universality/modules/metrics.py",
  "demos/universality/surface.mjs",
  "demos/universality/third-party/src/mmp_independent_decorator/server.py",
];
const pins = Object.fromEntries(await Promise.all(files.map(async file => [
  file, createHash("sha256").update(await readFile(new URL(file, root))).digest("hex"),
])));
await writeFile(new URL("pins.json", import.meta.url), `${JSON.stringify(pins, null, 2)}\n`);
