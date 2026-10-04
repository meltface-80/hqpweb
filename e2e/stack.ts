// Browser-test stack: one fake HQPlayer per flow, the real server serving the built
// web app, and a loopback control endpoint the tests use to change a fake's state
// (what a listener or HQPlayer itself would do: queue a track, restart louder).
//   node e2e/stack.ts        (needs `npm run build -w apps/web` first)
// Each flow gets its own instance, so flows can't disturb each other.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { FakeHqp, loadProfile, type FakeOptions, type ProfileId } from "@app/fake-hqp";
import { buildApp } from "../apps/server/src/app.ts";
import type { InstanceConfig } from "../apps/server/src/config.ts";
import type { WatchTiming } from "../apps/server/src/watch.ts";

export const APP_PORT = 4390;
export const CONTROL_PORT = 4391;

/** Set a fake's filter for one slot, by name (indices depend on the mode). */
function setFilter(fake: FakeHqp, slot: "filter1x" | "filterNx", name: string) {
  const f = fake.lists.filters.find((x) => x.name === name);
  if (!f) throw new Error(`no filter ${name} in ${fake.profile.id}`);
  fake.rem[slot] = f.index;
}
/** Fix the output rate (0 = auto), by Hz. */
function setRate(fake: FakeHqp, hz: number) {
  const i = fake.lists.rates.indexOf(hz);
  if (i < 0) throw new Error(`no rate ${hz} in ${fake.profile.id}`);
  fake.rateIndex = i;
}

interface Flow {
  name: string;
  profile: ProfileId;
  setup?: (fake: FakeHqp) => void;
  /** Simulated machine speed (1 = real time), e.g. a filter this machine can't keep up with. */
  speed?: FakeOptions["speed"];
}

// Keyed by instance id; the tests select an instance by id.
const FLOWS: Record<string, Flow> = {
  // SDM at auto rate, playing from Roon: every filter fits.
  pick: { name: "Pick a filter", profile: "desktop5-mac-sdm" },
  // Playing, on a machine that runs poly-sinc-gauss-long at half real time: picking it is rolled back.
  rollback: {
    name: "Rollback",
    profile: "desktop5-mac-sdm",
    speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1),
  },
  // PCM fixed at 192k, playing 44.1k: power-of-two filters (FFT) can't convert 4.35×.
  ratio: {
    name: "Ratio",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 192_000);
      f.playback = 2;
    },
  },
  // Stopped, fixed at 192k with FFT as the 1x filter: a queued 44.1k track can't start.
  wedge: {
    name: "Queued track",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 192_000);
      setFilter(f, "filter1x", "FFT");
      f.playback = 0;
      f.feeder = "playlist";
    },
  },
  jump: { name: "Volume jump", profile: "desktop5-mac-sdm", setup: (f) => (f.volume = -44) },
  // A recording that keeps needing apodization, played through a filter that isn't apodizing.
  apod: {
    name: "Apodization",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setFilter(f, "filter1x", "poly-sinc-hb");
      f.apod = 25;
    },
  },
  volume: { name: "Volume", profile: "desktop5-mac-sdm", setup: (f) => (f.volume = -30) },
  advanced: { name: "Advanced", profile: "desktop5-linux-pcm", setup: (f) => (f.playback = 2) },
  about: { name: "About", profile: "desktop5-mac-sdm" },
};

/** What a test may change on a fake. Anything else is refused. */
interface Poke {
  volume?: number;
  apod?: number;
  playlist?: string[];
  sourceRate?: number;
}

// Short playback checks, as in the server's own tests: flows finish in seconds.
const FAST: WatchTiming = { graceMs: 100, healthyMs: 300, maxMs: 1200, sampleMs: 40, minSpeed: 0.85 };

export async function startStack() {
  const fakes = new Map<string, FakeHqp>();
  const instances: InstanceConfig[] = [];
  for (const [id, flow] of Object.entries(FLOWS)) {
    const fake = new FakeHqp(loadProfile(flow.profile), { timeScale: 0, ...(flow.speed ? { speed: flow.speed } : {}) });
    flow.setup?.(fake);
    await fake.listen();
    fakes.set(id, fake);
    instances.push({ id, name: flow.name, host: "127.0.0.1", port: fake.port });
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
