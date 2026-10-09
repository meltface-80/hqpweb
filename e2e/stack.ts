// Browser-test stack: one fake HQPlayer per flow, the real server serving the built
// web app, and a loopback control endpoint the tests use to change a fake's state
// (what a listener or HQPlayer itself would do: queue a track, restart louder).
//   node e2e/stack.ts        (needs `npm run build -w apps/web` first)
// Each flow gets its own instance, so flows can't disturb each other.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { FakeHqp, FakeMeter, loadProfile } from "@app/fake-hqp";
import type { Flows } from "./flows-kit.ts";
import { buildApp } from "../apps/server/src/app.ts";
import type { InstanceConfig } from "../apps/server/src/config.ts";
import type { WatchTiming } from "../apps/server/src/watch.ts";

export const APP_PORT = 4390;
export const CONTROL_PORT = 4391;

/** Every flow, from the *.flows.ts files beside the specs: each spec declares its own fakes. */
async function loadFlows(): Promise<Flows> {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const all: Flows = {};
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".flows.ts"))
    .sort()) {
    const { flows } = (await import(new URL(file, import.meta.url).href)) as { flows: Flows };
    for (const [id, flow] of Object.entries(flows)) {
      if (all[id]) throw new Error(`flow ${id} is declared twice (${file})`);
      all[id] = flow;
    }
  }
  return all;
}

/** What a test may change on a fake. Anything else is refused. */
interface Poke {
  volume?: number;
  apod?: number;
  playlist?: string[];
  sourceRate?: number;
  /** Stop answering, as an overloaded or crashed HQPlayer would. */
  down?: boolean;
}

// Short playback checks, as in the server's own tests: flows finish in seconds.
const FAST: WatchTiming = { graceMs: 100, healthyMs: 300, maxMs: 1200, sampleMs: 40, minSpeed: 0.85 };

export async function startStack() {
  const fakes = new Map<string, FakeHqp>();
  const instances: InstanceConfig[] = [];
  for (const [id, flow] of Object.entries(await loadFlows())) {
    const fake = new FakeHqp(loadProfile(flow.profile), { timeScale: 0, ...(flow.speed ? { speed: flow.speed } : {}) });
    flow.setup?.(fake);
    await fake.listen();
    fakes.set(id, fake);
    // Port 1: nothing listens, so a flow without a meter can't reach another fake's port.
    const meterPort = flow.meter ? await new FakeMeter(fake).listen() : 1;
    instances.push({ id, name: flow.name, host: "127.0.0.1", port: fake.port, meterPort });
  }
  const app = buildApp(
    { instances },
    {
      staticDir: fileURLToPath(new URL("../apps/web/dist", import.meta.url)),
      pollMs: 250,
      timing: { quick: FAST, major: { ...FAST, maxMs: 1500 } },
      playWaitMs: 400,
      queueEveryMs: 300,
    },
  );
  await app.listen(APP_PORT, "127.0.0.1");

  const control = createServer((req, res) => {
    const id = req.url?.match(/^\/fake\/([a-z0-9-]+)$/)?.[1];
    const fake = id ? fakes.get(id) : undefined;
    if (req.method !== "POST" || !fake) return res.writeHead(404).end();
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const p = JSON.parse(body) as Poke;
      if (p.volume !== undefined) fake.volume = p.volume;
      if (p.apod !== undefined) fake.apod = p.apod;
      if (p.playlist !== undefined) fake.playlist = p.playlist;
      if (p.sourceRate !== undefined) fake.setSource(p.sourceRate);
      if (p.down) void fake.close();
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => control.listen(CONTROL_PORT, "127.0.0.1", r));

  return async () => {
    control.close();
    await app.close();
    await Promise.all([...fakes.values()].map((f) => f.close()));
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stop = await startStack();
  console.error(`browser-test stack: app on http://127.0.0.1:${APP_PORT}, control on ${CONTROL_PORT}`);
  for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => void stop().finally(() => process.exit(0)));
}
