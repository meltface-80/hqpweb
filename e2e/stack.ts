// Browser-test stack: one fake HQPlayer per flow, the real server serving the built
// web app, and a loopback control endpoint the tests use to change a fake's state
// (what a listener or HQPlayer itself would do: queue a track, restart louder).
//   node e2e/stack.ts        (needs `npm run build -w apps/web` first)
// Each flow gets its own instance, so flows can't disturb each other.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { FakeHqp, FakeMeter, loadProfile, type FakeOptions, type ProfileId } from "@app/fake-hqp";
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
/** Set the modulator or dither, by name. */
function setShaper(fake: FakeHqp, name: string) {
  const s = fake.lists.shapers.find((x) => x.name === name);
  if (!s) throw new Error(`no shaper ${name} in ${fake.profile.id}`);
  fake.rem.shaper = s.index;
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
  /** A fake meter stream beside it (the fake's meter.ts); without one, nothing listens there. */
  meter?: boolean;
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
  // Playing from HQPlayer's own playlist at 176.4k with sinc-M: 192k stops it, and it doesn't resume by itself.
  restart: {
    name: "Restart",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 176_400);
      setFilter(f, "filter1x", "sinc-M");
      f.feeder = "playlist";
      f.playlist = ["/music/Example Artist/Example Album/01 - Example.flac"];
      f.playback = 2;
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
  // SDM fixed at DSD512 with an old modulator, no setup answers yet: the guide's flow.
  guide: {
    name: "Guide",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 22_579_200);
      setShaper(f, "DSD7");
    },
  },
  // PCM fixed at 384k with TPDF, playing, no setup answers yet: the dither guide's flow.
  dither: {
    name: "Dither",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 384_000);
      setShaper(f, "TPDF");
      f.playback = 2;
    },
  },
  // Stopped at DSD512 with AHM7EC8B (needs DSD1024): a queued track can't start, because of the modulator.
  wedgemod: {
    name: "Queued track, modulator",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 22_579_200);
      setShaper(f, "AHM7EC8B");
      f.playback = 0;
      f.feeder = "playlist";
    },
  },
  // Playing at DSD1024 with AHM7EC8B: rate and modulator have to change together.
  pairnet: {
    name: "Pairs",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 45_158_400);
      setShaper(f, "AHM7EC8B");
    },
  },
  // A short screen: the sheet's body must scroll to its end.
  scroll: { name: "Scroll", profile: "desktop5-mac-sdm" },
  // Playing on a machine that can't keep up with anything: the falling-behind alarm.
  behind: { name: "Behind", profile: "desktop5-mac-sdm", speed: () => 0.6 },
  // HQPlayer stops answering (a test closes it): the restart steps.
  down: { name: "Down", profile: "desktop5-mac-sdm" },
  // Named DACs behind one HQPlayer: answers follow the DAC in use.
  dacs: { name: "DACs", profile: "desktop5-mac-sdm" },
  // The v2 layout preview (docs/design-v2-layout.md).
  v2: { name: "V2", profile: "desktop5-mac-sdm" },
  v2auto: { name: "V2 auto", profile: "desktop5-mac-sdm" },
  v2mini: { name: "V2 mini", profile: "desktop5-mac-sdm" },
  v2meter: { name: "V2 meter", profile: "desktop5-mac-sdm", meter: true },
  v2filters: { name: "V2 filters", profile: "desktop5-mac-sdm" },
  v2shaper: { name: "V2 modulators", profile: "desktop5-mac-sdm" },
  v2compare: { name: "V2 compare", profile: "desktop5-mac-sdm" },
  v2guide: { name: "V2 guide", profile: "desktop5-mac-sdm" },
  v2apod: {
    name: "V2 apodization",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setFilter(f, "filter1x", "poly-sinc-hb");
      f.apod = 25;
    },
  },
  // Settings → Your setup: answers saved on the server, per instance.
  setup: { name: "Setup", profile: "desktop5-mac-sdm" },
};

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
  for (const [id, flow] of Object.entries(FLOWS)) {
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
