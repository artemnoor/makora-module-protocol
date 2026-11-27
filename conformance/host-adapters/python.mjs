import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { errorKey } from "@artemnoor/mmp";

const here = dirname(fileURLToPath(import.meta.url));
const bridge = resolve(here, "../python-bridge.py");
const requestTimeoutMs = 30_000;
const startTimeoutMs = 60_000;
const closeTimeoutMs = 10_000;

function unavailable(message, cause) {
  const error = new Error(message);
  error.code = "HOST_UNAVAILABLE";
  if (cause) error.cause = cause;
  return error;
}

function pythonHostDirectory() {
  if (process.env.MMP_PYTHON_HOST_DIR) return resolve(process.env.MMP_PYTHON_HOST_DIR);
  const candidates = [resolve(process.cwd(), "python-host"), resolve(here, "../..", "python-host")];
  return candidates.find(candidate => existsSync(join(candidate, "pyproject.toml"))) ?? candidates[0];
}

function launch(pythonHost) {
  if (!existsSync(join(pythonHost, "pyproject.toml"))) {
    throw unavailable(`Python Host package not found: ${pythonHost} (expected python-host/pyproject.toml)`);
  }
  const configured = process.env.MMP_PYTHON;
  const executable = configured ?? (process.platform === "win32"
    ? join(pythonHost, ".venv/Scripts/python.exe") : join(pythonHost, ".venv/bin/python"));
  const env = {
    ...process.env,
    MMP_PYTHON_HOST_DIR: pythonHost,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8:strict",
    PYTHONPATH: [join(pythonHost, "src"), pythonHost, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  };
  if (configured || existsSync(executable)) return { command: executable, args: ["-X", "utf8", bridge], env };
  return {
    command: process.env.MMP_UV ?? "uv",
    args: ["run", "--project", pythonHost, "--locked", "python", "-X", "utf8", bridge],
    env,
  };
}

function contractId(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8")).schema?.$id ?? null;
  } catch {
    return null;
  }
}

function pythonConfig(config) {
  return {
    contracts: config.catalog.map(({ file, digest }) => ({ id: contractId(file), file, sha256: digest })),
    providers: config.packages.map(provider => ({
      id: provider.id,
      publisher: provider.publisher,
      version: provider.version,
      command: provider.command,
      args: provider.args,
      env: provider.moduleEnvironment ?? {},
      files: provider.files ?? {},
      root: provider.root,
      cwd: provider.root,
    })),
    knownPermissions: config.knownPermissions,
    grants: config.grants,
    address: ["127.0.0.1", 0],
    maxMessageBytes: 64 * 1024,
    maxDataDepth: 32,
    timeoutSeconds: Math.max(1, Math.ceil((config.maxDurationMs ?? 10_000) / 1000)),
    maxDepth: config.maxDepth ?? 8,
  };
}

function callResult(error) {
  const correlationId = error.correlationId ?? error.correlation_id;
  const meta = {
    kind: error.kind,
    message: error.message,
    retryable: error.retryable,
    outcome: error.outcome,
    correlationId,
  };
  if (typeof meta.kind !== "string" || typeof meta.message !== "string" ||
    typeof meta.retryable !== "boolean" || typeof meta.outcome !== "string" ||
    typeof meta.correlationId !== "string") {
    throw new Error(`Python Host returned an incomplete MMP error: ${JSON.stringify(error)}`);
  }
  return {
    isError: true,
    _meta: { [errorKey]: meta },
    content: [{ type: "text", text: meta.message }],
  };
}

function hostFailure(failure) {
  const error = new Error(`Python Host failure: ${failure?.message ?? "unknown bridge failure"}`);
  error.code = "PYTHON_HOST_FAILURE";
  if (failure?.traceback) error.traceback = failure.traceback;
  return error;
}

export async function start(config) {
  const pythonHost = pythonHostDirectory();
  const details = launch(pythonHost);
  const child = spawn(details.command, details.args, {
    cwd: process.cwd(), env: details.env, stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const stderr = [];
  let nextId = 1;
  let started = false;
  let closed = false;
  let closing;
  let fatal;

  const fail = error => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fatal = unavailable(`Python bridge returned invalid JSON: ${line.slice(0, 200)}`);
      fail(fatal);
      return;
    }
    if (message.op === "fatal") {
      fatal = unavailable(`Python bridge failed: ${message.message}`);
      fail(fatal);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.value);
    else if (message.error && typeof message.error.kind === "string") {
      entry.reject(Object.assign(new Error(message.error.message ?? message.error.kind), { mmpError: message.error }));
    } else entry.reject(hostFailure(message.failure ?? message));
  });
  child.stderr.on("data", chunk => {
    stderr.push(chunk.toString());
    if (stderr.length > 32) stderr.shift();
  });
  child.on("error", error => {
    if (closed) return;
    fatal = unavailable(`Cannot start the Python bridge: ${error.message}`, error);
    fail(fatal);
  });
  child.on("exit", (code, signal) => {
    if (closed) return;
    const tail = stderr.join("").trim().split("\n").slice(-8).join("\n");
    const error = started
      ? new Error(`Python Host process exited (${signal ?? code})${tail ? `:\n${tail}` : ""}`)
      : unavailable(`Python Host process exited during startup (${signal ?? code})${tail ? `:\n${tail}` : ""}`);
    error.code = started ? "HOST_CHILD_EXITED" : "HOST_UNAVAILABLE";
    fatal = error;
    fail(error);
  });

  function request(message, timeoutMs = requestTimeoutMs) {
    if (fatal) return Promise.reject(fatal);
    if (closed) return Promise.reject(new Error("Python Host adapter is closed"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(`Python bridge request timed out after ${timeoutMs}ms`);
        error.code = "HOST_TIMEOUT";
        reject(error);
        child.kill();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...message, id })}\n`, error => {
        if (!error) return;
        pending.delete(id);
        clearTimeout(timer);
        reject(unavailable(`Cannot write to the Python bridge: ${error.message}`, error));
      });
    });
  }

  async function close() {
    if (closed) return;
    if (closing) return closing;
    closing = (async () => {
      try {
        await request({ op: "close" }, closeTimeoutMs);
      } catch {
        // The process may already be gone; closing below is still required.
      }
      closed = true;
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise(resolve => {
          const timer = setTimeout(() => {
            child.kill();
            resolve();
          }, closeTimeoutMs);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    })();
    return closing;
  }

  try {
    const value = await request({ op: "start", config: pythonConfig(config) }, startTimeoutMs);
    started = true;
    return {
      language: "python",
      gateway: value?.gateway,
      call: async (caller, invocation, options = {}) => {
        const callId = nextId;
        const remaining = options.deadline === undefined ? requestTimeoutMs
          : Math.max(1000, options.deadline - Date.now() + 5000);
        const promise = request({
          op: "call",
          caller,
          invocation,
          options: { deadline_ms: options.deadline },
        }, remaining);
        let abort;
        if (options.signal) {
          abort = () => {
            if (pending.has(callId)) {
              child.stdin.write(`${JSON.stringify({ op: "cancel", target: callId })}\n`, () => {});
            }
          };
          if (options.signal.aborted) abort();
          else options.signal.addEventListener("abort", abort, { once: true });
        }
        try {
          const result = await promise;
          return result;
        } catch (error) {
          if (error?.mmpError) return callResult(error.mmpError);
          throw error;
        } finally {
          if (abort) options.signal.removeEventListener("abort", abort);
        }
      },
      select: async (triple, id) => {
        try {
          await request({ op: "select", triple, moduleId: id }, requestTimeoutMs);
        } catch (error) {
          if (error?.mmpError) throw Object.assign(new Error(error.mmpError.message ?? error.mmpError.kind), error.mmpError);
          throw error;
        }
      },
      close,
    };
  } catch (error) {
    await close();
    if (error?.code === "HOST_TIMEOUT") {
      throw unavailable(`Python Host did not start within ${startTimeoutMs}ms`, error);
    }
    if (error?.code) throw error;
    const failure = new Error(`Python Host rejected the configuration: ${error?.message ?? error}`);
    failure.code = "HOST_START_FAILED";
    failure.mmpError = error;
    throw failure;
  }
}
