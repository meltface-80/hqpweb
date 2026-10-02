// HTTP API. Quick changes only (design §4.2); mode and rate need the rollback
// engine and come next.
import Fastify, { type FastifyReply } from "fastify";
import type { AppConfig } from "./config.ts";
import { HttpError, Instance, type QuickChange } from "./instance.ts";

const quickBody = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    filterNx: { type: "string", minLength: 1 },
    filter1x: { type: "string", minLength: 1 },
    shaper: { type: "string", minLength: 1 },
    volume: { type: "number" },
    invert: { type: "boolean" },
    filter20k: { type: "boolean" },
    adaptive: { type: "boolean" },
  },
} as const;

export function buildApp(config: AppConfig, opts: { pollMs?: number } = {}) {
  // forceCloseConnections: open SSE streams must not keep the server alive on close.
  // coerceTypes off: "-20" must not pass as a volume.
  const app = Fastify({ logger: false, forceCloseConnections: true, ajv: { customOptions: { coerceTypes: false } } });
  const instances = new Map(config.instances.map((i) => [i.id, new Instance(i)]));

  app.addHook("onClose", async () => {
    for (const i of instances.values()) i.close();
  });

  const get = (id: string) => {
    const i = instances.get(id);
    if (!i) throw new HttpError(404, "unknown instance");
    return i;
  };

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply: FastifyReply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    // Anything else is a failure talking to the instance.
    return reply.code(502).send({ error: `instance error: ${err.message}` });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/instances", async () => config.instances.map(({ id, name }) => ({ id, name })));

  app.get<{ Params: { id: string } }>("/api/instances/:id/now", async (req) => get(req.params.id).now());

  app.get<{ Params: { id: string } }>("/api/instances/:id/capabilities", async (req) =>
    get(req.params.id).capabilities(),
  );

  app.post<{ Params: { id: string }; Body: QuickChange }>(
    "/api/instances/:id/quick",
    { schema: { body: quickBody } },
    async (req) => get(req.params.id).applyQuick(req.body),
  );

  app.post<{ Params: { id: string } }>("/api/instances/:id/undo", async (req) => get(req.params.id).undo());

  // Server-sent events: `now` with {status, state}, or `unreachable` with {error}.
  app.get<{ Params: { id: string } }>("/api/instances/:id/events", (req, reply) => {
    const inst = get(req.params.id);
    reply.hijack();
    const res = reply.raw;
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
    req.raw.on("close", unsubscribe);
  });

  return app;
}
