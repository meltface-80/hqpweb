// "Kept up here" end to end: while someone watches (the status stream runs), settled
// playback is recorded per DAC, combination and source rate, and offered with the
// capabilities. Failures carry the source rate too.
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile, type FakeOptions } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import type { KeptTiming } from "../src/kept-up.ts";
import type { KeptUp } from "../src/learned.ts";
import type { WatchTiming } from "../src/watch.ts";
import { client } from "./http.ts";

const KEPT: KeptTiming = { warmupMs: 150, windowMs: 100, minWindows: 3, maxGapMs: 1000 };
const FAST: WatchTiming = { graceMs: 100, healthyMs: 300, maxMs: 1200, sampleMs: 40, minSpeed: 0.85 };

let fake: FakeHqp;
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;
let base: string;
const streams: AbortController[] = [];
afterEach(async () => {
  streams.splice(0).forEach((c) => c.abort());
  await app.close();
  await fake.close();
});

async function setup(opts: FakeOptions = {}) {
  fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0, ...opts });
  await fake.listen();
  app = buildApp(
    { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] },
    { pollMs: 20, keptTiming: KEPT, timing: { quick: FAST, major: FAST }, playWaitMs: 400 },
  );
  base = await app.listen(0, "127.0.0.1");
  req = client(base);
}
/** Someone watching: keeps the status poller running. */
async function watch() {
  const ctl = new AbortController();
  streams.push(ctl);
  const res = await fetch(`${base}/api/instances/mac/events`, { signal: ctl.signal });
  void res
    .body!.getReader()
    .read()
    .catch(() => undefined);
}
const kept = async (): Promise<KeptUp[]> => (await req("GET", "/api/instances/mac/capabilities")).json().keptUp;
async function until<T>(f: () => Promise<T>, ok: (x: T) => boolean, ms = 4000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const x = await f();
    if (ok(x) || Date.now() - t0 > ms) return x;
    await new Promise((r) => setTimeout(r, 50)); // polling for a condition, with a deadline
  }
}

describe("kept up here, live", () => {
  it("records settled playback with its source rate and speed, only while someone watches", async () => {
    await setup();
    // Nobody watching: nothing polls Status, so nothing is measured.
    expect(await kept()).toEqual([]);
    expect(fake.received.some((x) => x.includes("<Status"))).toBe(false);
    await watch();
    const list = await until(kept, (l) => l.length > 0);
    expect(list).toEqual([
      expect.objectContaining({
        instance: "mac",
        sourceRate: 44_100,
        mode: "SDM (DSD)",
        filter1x: "poly-sinc-gauss-xla",
        shaper: "AHM7EC8B",
        low: 25,
        typical: 25,
      }),
    ]);
  });

  it("keeps a named DAC's record apart from the first DAC's", async () => {
    await setup();
    await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    await req("PUT", "/api/instances/mac/dac", { body: { dac: "desk" } });
    await watch();
    const list = await until(kept, (l) => l.length > 0);
    expect(list[0]!.instance).toBe("mac#desk");
    await req("PUT", "/api/instances/mac/dac", { body: { dac: "main" } });
    expect(await kept()).toEqual([]);
  });

  it("records the source rate of a combination that failed", async () => {
    await setup({ speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) });
    await req("POST", "/api/instances/mac/change", { body: { filter1x: "poly-sinc-gauss-long" } });
    const learned = (await req("GET", "/api/instances/mac/learned")).json();
    expect(learned[0]).toMatchObject({ filter1x: "poly-sinc-gauss-long", sourceRates: [44_100] });
  });
});
