// HTTP API. Read-only for now: the change engine (classify → apply → verify →
// rollback, design §4.2) comes next and is the only place writes will live.
import Fastify from "fastify";
import { HqpClient } from "@app/protocol";
import type { AppConfig } from "./config.ts";

export function buildApp(config: AppConfig) {
  const app = Fastify({ logger: false });
  const clients = new Map(config.instances.map((i) => [i.id, new HqpClient(i.host, { port: i.port, timeoutMs: 5000 })]));

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/instances", async () => config.instances.map(({ id, name }) => ({ id, name })));

  app.get<{ Params: { id: string } }>("/api/instances/:id/now", async (req, reply) => {
    const c = clients.get(req.params.id);
    if (!c) return reply.code(404).send({ error: "unknown instance" });
    try {
      const [info, state, status] = await Promise.all([c.info(), c.state(), c.status()]);
      return { info, state, status };
    } catch (e) {
      return reply.code(502).send({ error: `instance unreachable: ${(e as Error).message}` });
    }
  });

  return app;
}
