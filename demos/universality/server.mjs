import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHarness } from "./harness.mjs";
import { systems } from "./config.mjs";

const headers = {
  "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
};
const appPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const modulePolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms; form-action 'none'; base-uri 'none'";
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);
const json = (res, status, body) => {
  res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

async function body(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw bad("Ожидается JSON", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw bad("Слишком большой запрос", 413);
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
    return parsed;
  } catch {
    throw bad("Некорректный JSON");
  }
}

export async function startDemo({ port = 0, aiMode = "fixture", delay = 0 } = {}) {
  const app = createHarness({ aiMode, delay });
  const name = `mmpdemo_${randomUUID().slice(0, 8)}`;
  function owner(req) {
    return req.headers.cookie?.split(/;\s*/).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  }
  let url;
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(url).host) throw bad("Недопустимый адрес", 403);
      const pathname = new URL(req.url, url).pathname;
      if (req.method === "GET" && files.has(pathname)) {
        const [file, contentType] = files.get(pathname);
        const result = await readFile(new URL(`web/${file}`, import.meta.url));
        res.writeHead(200, { ...headers, "content-type": contentType, "content-security-policy": appPolicy,
          ...(pathname === "/" && !owner(req) ? {
            "set-cookie": `${name}=${randomUUID()}; HttpOnly; SameSite=Strict; Path=/`,
          } : {}),
        });
        res.end(result);
        return;
      }
      const session = owner(req);
      if (!session || !/^[\da-f-]{36}$/.test(session)) throw bad("Откройте приложение в браузере", 401);
      if (req.method === "POST" && req.headers.origin !== url) throw bad("Недопустимый источник", 403);
      if (req.method === "GET" && pathname === "/api") return json(res, 200, { aiMode, systems, runs: app.list(session) });
      if (req.method === "POST" && pathname === "/api/runs") {
        const { task, system } = await body(req);
        return json(res, 202, app.start(session, task, system));
      }
      const match = /^\/api\/runs\/([\da-f-]{36})(?:\/(ui|resume|cancel))?$/.exec(pathname);
      if (match) {
        const [, id, action] = match;
        if (req.method === "GET" && !action) return json(res, 200, app.get(session, id));
        if (req.method === "POST" && action === "resume") return json(res, 202, app.resume(session, id, await body(req)));
        if (req.method === "POST" && action === "cancel") return json(res, 200, app.cancel(session, id));
        if (req.method === "GET" && action === "ui") {
          const html = await app.form(session, id);
          res.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8", "content-security-policy": modulePolicy });
          res.end(html);
          return;
        }
      }
      throw bad("Страница не найдена", 404);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        json(res, error.status ?? 500, { error: error.status ? error.message : "Не удалось выполнить запрос" });
      }
    }
  });
  server.requestTimeout = 8000;
  server.listen(port, "127.0.0.1");
  try {
    await once(server, "listening");
  } catch (error) {
    await app.close();
    throw error;
  }
  url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, app,
    async close() {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await Promise.all([closed, app.close()]);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = await startDemo({ port: Number(process.env.MMP_PORT ?? 0), aiMode: process.env.MMP_AI_MODE ?? "fixture" });
  console.log(`MMP Universality Lab · ${demo.url}`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void demo.close(); });
}
