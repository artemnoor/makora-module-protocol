import { equal, ok, rejects } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { errorKey } from "@artemnoor/mmp";
import { createHost } from "./host-adapters/index.mjs";
import { digest, python, root } from "./config.mjs";

const fakeHost = `
class MMPError(Exception):
    def __init__(self, kind, message, outcome="not-started"):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.outcome = outcome
        self.retryable = False
        self.correlation_id = "0123456789abcdef0123456789abcdef"

    def as_dict(self):
        return {
            "kind": self.kind,
            "message": self.message,
            "retryable": self.retryable,
            "outcome": self.outcome,
            "correlationId": self.correlation_id,
        }


class Host:
    def __init__(self, config):
        self.config = config
        self.gateway = "http://127.0.0.1:1/mcp"

    @classmethod
    async def start(cls, config):
        return cls(config)

    def select(self, triple, module_id):
        return None

    async def invoke(self, caller, request, deadline_ms=None):
        capability = request["capability"]
        if capability.endswith("/cancel"):
            raise MMPError("CANCELLED", "cancelled", "unknown")
        if capability.endswith("/failure"):
            raise RuntimeError("fake bridge failure")
        return {
            "outputContract": request["outputContract"],
            "result": {"findings": [self.config["contracts"][0]["file"]]},
        }

    async def close(self):
        return None
`;

test("Python bridge preserves non-ASCII paths over UTF-8 JSONL", async () => {
  const temp = await mkdtemp(join(tmpdir(), "mmp-bridge-"));
  const previous = {
    host: process.env.MMP_PYTHON_HOST_DIR,
    python: process.env.MMP_PYTHON,
  };
  try {
    await writeFile(join(temp, "pyproject.toml"), "");
    await writeFile(join(temp, "mmp_host.py"), fakeHost);
    const contract = join(temp, "контракты", "task.json");
    await mkdir(join(temp, "контракты"), { recursive: true });
    const data = readFileSync(join(root, "contracts/task.json"));
    await writeFile(contract, data);
    const schema = JSON.parse(data.toString("utf8")).schema;
    process.env.MMP_PYTHON_HOST_DIR = temp;
    process.env.MMP_PYTHON = python;
    const host = await createHost("python", {
      catalog: [{ file: contract, digest: digest(data) }],
      packages: [],
      grants: [],
      knownPermissions: [],
    });
    try {
      const invocation = {
        capability: "org.example/echo",
        inputContract: schema.$id,
        outputContract: schema.$id,
        arguments: { topic: "non-ascii" },
      };
      const success = await host.call("host:bridge", invocation);
      equal(success.isError, undefined, JSON.stringify(success));
      equal(success.structuredContent.result.findings[0], contract);
      ok(contract.includes("контракты"));

      const cancelled = await host.call("host:bridge", { ...invocation, capability: "org.example/cancel" });
      equal(cancelled.isError, true, JSON.stringify(cancelled));
      equal(cancelled._meta[errorKey].kind, "CANCELLED");
      equal(cancelled._meta[errorKey].outcome, "unknown");
      equal(cancelled._meta[errorKey].retryable, false);
      equal(cancelled._meta[errorKey].correlationId, "0123456789abcdef0123456789abcdef");
      equal(cancelled.structuredContent, undefined);

      await rejects(host.call("host:bridge", { ...invocation, capability: "org.example/failure" }), /Python Host failure/);
    } finally {
      await host.close();
    }
  } finally {
    if (previous.host === undefined) delete process.env.MMP_PYTHON_HOST_DIR;
    else process.env.MMP_PYTHON_HOST_DIR = previous.host;
    if (previous.python === undefined) delete process.env.MMP_PYTHON;
    else process.env.MMP_PYTHON = previous.python;
    await rm(temp, { recursive: true, force: true });
  }
});
