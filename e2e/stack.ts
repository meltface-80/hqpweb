// Browser-test stack: one fake HQPlayer per flow, the real server serving the built
// web app, and a loopback control endpoint the tests use to change a fake's state
// (what a listener or HQPlayer itself would do: queue a track, restart louder).
//   node e2e/stack.ts        (needs the web app and e2e/app-host built first)
// Each flow gets its own instance, so flows can't disturb each other; and each lane (a host
// in an engine, lanes.ts) its own set of fakes, so lanes can't either. The phone app's lanes
// are served by its test build (app-host.ts).
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { FakeHqp, FakeMeter, FakeRoon, loadProfile } from "@app/fake-hqp";
import type { Flows } from "./flows-kit.ts";
import { buildApp } from "../apps/server/src/app.ts";
import { RoonLink, type InstanceConfig } from "@app/core";
import { startAppHost } from "./app-host.ts";
import { TUNING } from "./tuning.ts";

import { CONTROL_PORT, LANES } from "./lanes.ts";

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

/** One fake per flow (and its meter, if the flow has one), as instances to configure. */
async function startFakes(flows: Flows) {
  const fakes = new Map<string, FakeHqp>();
  const instances: InstanceConfig[] = [];
  for (const [id, flow] of Object.entries(flows)) {
    const fake = new FakeHqp(loadProfile(flow.profile), {
      timeScale: 0,
      ...(flow.speed ? { speed: flow.speed } : {}),
      ...(flow.busyAfterFilter ? { busyAfterFilter: flow.busyAfterFilter } : {}),
      ...(flow.busyAfterModeSwitch ? { busyAfterModeSwitch: flow.busyAfterModeSwitch } : {}),
      ...flow.options,
    });
    flow.setup?.(fake);
    await fake.listen();
    fakes.set(id, fake);
    // Port 1: nothing listens, so a flow without a meter can't reach another fake's port.
    const meterPort = flow.meter ? await new FakeMeter(fake).listen() : 1;
    instances.push({ id, name: flow.name, host: "127.0.0.1", port: fake.port, meterPort });
  }
  return { fakes, instances };
}

export async function startStack() {
  const flows = await loadFlows();
  type Running = { name: string; fakes: Map<string, FakeHqp>; roon: FakeRoon; roonPort: number; close: () => Promise<unknown> };
  const running: Running[] = [];
  for (const l of LANES) {
    const { fakes, instances } = await startFakes(flows);
    // A Roon Core per lane, off until a test switches Roon on and points the app at it.
    const roon = new FakeRoon();
    const roonPort = await roon.listen();
    if (l.host === "web") {
      const link = new RoonLink(null, { reconnectMs: 200 });
      const app = buildApp(
        { instances },
        { staticDir: fileURLToPath(new URL("../apps/web/dist", import.meta.url)), roon: link, ...TUNING },
      );
      await app.listen(l.port, "127.0.0.1");
      running.push({
        name: l.name,
        fakes,
        roon,
        roonPort,
        close: async () => (link.close(), await app.close(), await roon.close()),
      });
    } else {
      const host = await startAppHost(l.port, instances);
      running.push({ name: l.name, fakes, roon, roonPort, close: async () => (host.close(), await roon.close()) });
    }
  }

  // POST /fake/<id>?lane=<project>: change that lane's fake (hosts.ts fakeUrl).
  // GET /roon?lane=: its Roon Core's port; POST /roon/approve?lane=: Enable in Roon's Extensions.
  const control = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const roonLane = running.find((r) => r.name === url.searchParams.get("lane"));
    if (roonLane && req.method === "GET" && url.pathname === "/roon")
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ port: roonLane.roonPort }));
    if (roonLane && req.method === "POST" && url.pathname === "/roon/approve") {
      roonLane.roon.approve();
      return res.writeHead(204).end();
    }
    const id = url.pathname.match(/^\/fake\/([a-z0-9-]+)$/)?.[1];
    const fake = id ? running.find((r) => r.name === url.searchParams.get("lane"))?.fakes.get(id) : undefined;
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
    await Promise.all(running.map((r) => r.close()));
    await Promise.all(running.flatMap((r) => [...r.fakes.values()].map((f) => f.close())));
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stop = await startStack();
  console.error(
    `browser-test stack: ${LANES.map((l) => `${l.name} on http://127.0.0.1:${l.port}`).join(", ")}; control on ${CONTROL_PORT}`,
  );
  for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => void stop().finally(() => process.exit(0)));
}
