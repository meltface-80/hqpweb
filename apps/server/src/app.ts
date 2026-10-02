// HTTP API on node:http, no framework. Quick changes only (design §4.2); mode
// and rate need the rollback engine and come next.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AppConfig } from "./config.ts";
import { HttpError, Instance, type QuickChange } from "./instance.ts";

export interface AppOptions {
  pollMs?: number;
  /**
   * Hostnames this server answers to, besides loopback. Anything else is refused,
   * which blocks DNS rebinding: a hostile page can point its own name at this
   * server, but the browser still sends that name in Host.
   */
  allowedHosts?: string[];
}

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];
const MAX_BODY = 16 * 1024;

const QUICK_FIELDS: Record<keyof QuickChange, "name" | "number" | "boolean"> = {
  filterNx: "name",
  filter1x: "name",
  shaper: "name",
  volume: "number",
  invert: "boolean",
  filter20k: "boolean",
  adaptive: "boolean",
};

/** Strict: no unknown fields, no type coercion ("-20" is not a volume). */
export function parseQuickChange(body: unknown): QuickChange {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const entries = Object.entries(body);
  if (entries.length === 0) throw new HttpError(400, "empty change");
  for (const [k, v] of entries) {
    const kind = QUICK_FIELDS[k as keyof QuickChange];
    if (!kind) throw new HttpError(400, `unknown field "${k}"`);
    const ok =
      kind === "name" ? typeof v === "string" && v.length > 0
      : kind === "number" ? typeof v === "number" && Number.isFinite(v)
      : typeof v === "boolean";
    if (!ok) throw new HttpError(400, `"${k}" must be ${kind === "name" ? "a non-empty string" : `a ${kind}`}`);
  }
  return body as QuickChange;
}

const hostnameOf = (hostHeader: string) => hostHeader.replace(/:\d+$/, "").toLowerCase();

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "expected application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

type Handler = (req: IncomingMessage, res: ServerResponse, inst: Instance) => Promise<unknown> | void;

export function buildApp(config: AppConfig, opts: AppOptions = {}) {
  const instances = new Map(config.instances.map((i) => [i.id, new Instance(i)]));
  const allowed = new Set([...LOOPBACK, ...(opts.allowedHosts ?? []).map((h) => h.toLowerCase())]);

  const events: Handler = (req, res, inst) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Stops reverse proxies from buffering the stream.
      "x-accel-buffering": "no",
    });
    res.write(": connected\n\n");
    const unsubscribe = inst.subscribe((e) => {
      if (e.snapshot) res.write(`event: now\ndata: ${JSON.stringify(e.snapshot)}\n\n`);
      else res.write(`event: unreachable\ndata: ${JSON.stringify({ error: e.error })}\n\n`);
    }, opts.pollMs);
    req.on("close", unsubscribe);
  };

  // Per-instance routes: /api/instances/:id/<action>
  const routes: Record<string, Handler> = {
    "GET now": (_q, _r, i) => i.now(),
    "GET capabilities": (_q, _r, i) => i.capabilities(),
    "POST quick": async (q, _r, i) => i.applyQuick(parseQuickChange(await readJson(q))),
    "POST undo": (_q, _r, i) => i.undo(),
    "GET events": events,
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = hostnameOf(req.headers.host ?? "");
    if (!allowed.has(host)) throw new HttpError(403, `host "${host}" not allowed; add it to ALLOWED_HOSTS`);
    // Writes must come from our own pages: a cross-site Origin is refused.
    if (req.method !== "GET" && req.headers.origin) {
      let originHost = "";
      try {
        originHost = new URL(req.headers.origin).hostname.toLowerCase();
      } catch {}
      if (!allowed.has(originHost) && !allowed.has(`[${originHost}]`)) throw new HttpError(403, "cross-origin request refused");
    }

    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && path === "/api/instances")
      return send(res, 200, config.instances.map(({ id, name }) => ({ id, name })));

    const m = /^\/api\/instances\/([^/]+)\/([a-z]+)$/.exec(path);
    if (!m) throw new HttpError(404, "not found");
    const inst = instances.get(decodeURIComponent(m[1]!));
    if (!inst) throw new HttpError(404, "unknown instance");
    const route = routes[`${req.method} ${m[2]}`];
    if (!route) throw new HttpError(404, "not found");
    const out = await route(req, res, inst);
    if (out !== undefined) send(res, 200, out);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: Error) => {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) send(res, err.status, { error: err.message });
      // Anything else is a failure talking to the instance.
      else send(res, 502, { error: `instance error: ${err.message}` });
    });
  });

  return {
    server,
    listen(port: number, host: string): Promise<string> {
      return new Promise((resolve) =>
        server.listen(port, host, () => {
          const a = server.address();
          resolve(`http://${host}:${typeof a === "object" && a ? a.port : port}`);
        }),
      );
    },
    async close() {
      for (const i of instances.values()) i.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
