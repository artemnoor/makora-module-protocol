import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { connect, contextKey, errorKey, gatewayTransport } from "@artemnoor/mmp";
import { createConfig, digest, query, root } from "./config.mjs";
import { label, start } from "./harness.mjs";

const fixture = "conformance/gateway-fixture.mjs";
const content = result => {
  ok(result.isError === undefined || result.isError === false, JSON.stringify(result));
  return result.structuredContent.result;
};
const error = (value, kind) => {
  equal(value.isError, true, JSON.stringify(value));
  equal(value.structuredContent, undefined);
  const meta = value._meta?.[errorKey];
  ok(meta, JSON.stringify(value));
  equal(meta.kind, kind);
  equal(meta.outcome, "not-started");
  equal(typeof meta.retryable, "boolean");
  equal(typeof meta.message, "string");
  ok(meta.message.length > 0);
  ok(typeof meta.correlationId === "string" && meta.correlationId.length > 0);
  equal(Array.isArray(value.content), true);
  equal(typeof value.content[0]?.text, "string");
  ok(value.content[0].text.length > 0);
};

function config(probeFile) {
  const settings = createConfig();
  const hash = digest(readFileSync(new URL(`../${fixture}`, import.meta.url)));
  const provider = (role, id) => ({
    id, publisher: "org.example", version: "1.0.0", root,
    command: process.execPath, args: [fixture, role], files: { [fixture]: hash },
    moduleEnvironment: role === "a" ? { MMP_PROBE_FILE: probeFile } : undefined,
  });
  settings.packages.push(provider("a", "org.example.gateway-a"), provider("b", "org.example.gateway-b"));
  const grant = (caller, target, tool) => ({ caller, target, tool, effects: "read-only", permissions: [] });
  settings.grants.push(
    grant("host:demo", "org.example.gateway-a", "probe"),
    grant("host:demo", "org.example.gateway-a", "hold"),
    grant("host:demo", "org.example.gateway-b", "probe"),
    grant("org.example.gateway-a", "org.example.research", "research"),
    grant("org.example.gateway-b", "org.example.research", "research"),
  );
  return settings;
}

async function connectGateway(url, credential) {
  return connect(gatewayTransport(url, credential));
}

async function waitForProbe(file) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      await delay(20);
    }
  }
  throw new Error("Gateway probe file was not written");
}

test(label("official MCP Gateway client rejects missing, stale and foreign contexts"), async () => {
  const temp = await mkdtemp(join(tmpdir(), "mmp-gateway-"));
  const probeFile = join(temp, "probe.json");
  const host = await start(config(probeFile));
  const research = { ...query("research", "task", "report"), arguments: { topic: "gateway" } };
  let clientA;
  let clientB;
  let holding;
  try {
    equal((await fetch(host.gateway, { method: "POST", body: "{}" })).status, 401);
    equal((await fetch(host.gateway, {
      method: "POST", headers: { origin: "https://example.invalid" }, body: "{}",
    })).status, 403);

    const probedA = content(await host.call("host:demo", {
      ...query("probe-a", "task", "report"), arguments: { topic: "probe" },
    }));
    const probedB = content(await host.call("host:demo", {
      ...query("probe-b", "task", "report"), arguments: { topic: "probe" },
    }));
    const [credentialA, staleToken] = probedA.findings;
    const [credentialB] = probedB.findings;
    ok(typeof credentialA === "string" && credentialA.length > 0);
    ok(typeof credentialB === "string" && credentialB.length > 0);

    holding = host.call("host:demo", {
      ...query("hold", "task", "report"), arguments: { topic: "hold", waitMs: 2000 },
    });
    const active = await waitForProbe(probeFile);
    equal(active.credential, credentialA);

    clientA = await connectGateway(host.gateway, credentialA);
    clientB = await connectGateway(host.gateway, credentialB);
    error(await clientA.callTool({ name: "mmp_invoke", arguments: research }), "PERMISSION_DENIED");
    error(await clientA.callTool({
      name: "mmp_invoke", arguments: research, _meta: { [contextKey]: staleToken },
    }), "PERMISSION_DENIED");
    error(await clientB.callTool({
      name: "mmp_invoke", arguments: research, _meta: { [contextKey]: active.context },
    }), "PERMISSION_DENIED");
    const nested = await clientA.callTool({
      name: "mmp_invoke", arguments: research, _meta: { [contextKey]: active.context },
    });
    ok(nested.isError === undefined || nested.isError === false, JSON.stringify(nested));
    deepEqual(nested.structuredContent.result, { findings: ["typescript: gateway"] });
    ok((await holding).structuredContent.result.findings.includes("hold complete"));
  } finally {
    await clientA?.close();
    await clientB?.close();
    await holding?.catch(() => {});
    await host.close();
    await rm(temp, { recursive: true, force: true });
  }
});
