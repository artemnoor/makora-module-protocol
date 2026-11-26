import { deepEqual, equal } from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createConfig, moduleId, query } from "../examples/config.mjs";
import { startHost } from "../dist/reference/host/index.js";

test("a replaceable inference adapter preserves the module contract on a real MCP call", async () => {
  const requests = [];
  const service = createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    requests.push(JSON.parse(Buffer.concat(parts).toString("utf8")));
    res.writeHead(200, { "content-type": "application/json" }).end('{"findings":["fixture result"]}');
  });
  service.listen(0, "127.0.0.1");
  await once(service, "listening");
  let host;
  try {
    const config = createConfig();
    config.packages = config.packages.filter(item => item.id === moduleId("research"));
    config.packages[0].moduleEnvironment = {
      MMP_RESEARCH_PROVIDER: `http://127.0.0.1:${service.address().port}`,
    };
    host = await startHost(config);
    const result = await host.call("host:demo", {
      ...query("research", "task", "report"), arguments: { topic: "test topic" },
    });
    equal(result.isError, undefined);
    deepEqual(result.structuredContent.result, { findings: ["fixture result"] });
    deepEqual(requests, [{ topic: "test topic" }]);
  } finally {
    await host?.close();
    service.closeAllConnections();
    await new Promise(resolve => service.close(resolve));
  }
});
