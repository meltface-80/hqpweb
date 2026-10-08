// History and last-seen settings end to end (history.ts, wired in instance.ts): hqpweb's
// own changes are logged with before/after and how playback went; a change another app
// makes is logged as "elsewhere", once; each mode's settings are remembered per DAC.
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile, type FakeOptions } from "@app/fake-hqp";
import { HqpClient, cmd } from "@app/protocol";
import { buildApp } from "../src/app.ts";
import type { HistoryEntry } from "../src/history.ts";
import type { WatchTiming } from "../src/watch.ts";
import { client } from "./http.ts";

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
    { pollMs: 20, timing: { quick: FAST, major: FAST }, playWaitMs: 400 },
  );
  base = await app.listen(0, "127.0.0.1");
  req = client(base);
}
async function watch() {
  const ctl = new AbortController();
  streams.push(ctl);
  const res = await fetch(`${base}/api/instances/mac/events`, { signal: ctl.signal });
  void res
    .body!.getReader()
    .read()
    .catch(() => undefined);
}
const history = async (): Promise<HistoryEntry[]> => (await req("GET", "/api/instances/mac/history")).json();
const caps = async () => (await req("GET", "/api/instances/mac/capabilities")).json();
async function until<T>(f: () => Promise<T>, ok: (x: T) => boolean, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const x = await f();
    if (ok(x) || Date.now() - t0 > ms) return x;
    await new Promise((r) => setTimeout(r, 30)); // polling for a condition, with a deadline
  }
}

describe("history", () => {
  it("logs hqpweb's change with before, after and playback, and its undo", async () => {
    await setup();
    await req("POST", "/api/instances/mac/change", { body: { shaper: "ASDM7EC" } });
    await req("POST", "/api/instances/mac/undo");
    const [undo, change] = await history();
    expect(change).toMatchObject({
      instance: "mac",
      source: "hqpweb",
      changes: [{ field: "shaper", from: "AHM7EC8B", to: "ASDM7EC", applied: true }],
      playback: "playing",
    });
    expect(undo).toMatchObject({ source: "undo", changes: [{ field: "shaper", from: "ASDM7EC", to: "AHM7EC8B" }] });
  });

  it("leaves volume out: a volume tap alone isn't history (seen filling it on hqp-dev)", async () => {
    await setup();
    await req("POST", "/api/instances/mac/change", { body: { volume: -23 } });
    await req("POST", "/api/instances/mac/change", { body: { volume: -24, shaper: "ASDM7EC" } });
    const h = await history();
    expect(h.map((e) => e.changes.map((c) => c.field))).toEqual([["shaper"]]);
  });

  it("logs a change that was rolled back, and why", async () => {
    await setup({ speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) });
    await req("POST", "/api/instances/mac/change", { body: { filter1x: "poly-sinc-gauss-long" } });
    expect((await history())[0]).toMatchObject({ rolledBack: true, playback: "struggling", detail: expect.any(String) });
  });

  it("logs a change made elsewhere once, and never counts hqpweb's own as one", async () => {
    await setup();
    await watch();
    await until(caps, (c) => Object.keys(c.lastSeen).length > 0); // a baseline has been read
    await req("POST", "/api/instances/mac/change", { body: { shaper: "ASDM7EC" } });
    const other = new HqpClient("127.0.0.1", { port: fake.port });
    const fast = (await other.shapers()).find((x) => x.name === "ASDM7EC-fast")!.index;
    await other.send(cmd.setShaping(fast));
    other.close();
    const list = await until(history, (h) => h.some((e) => e.source === "elsewhere"));
    expect(list.map((e) => [e.source, e.changes.map((c) => `${c.field}:${String(c.to)}`).join()])).toEqual([
      ["elsewhere", "shaper:ASDM7EC-fast"],
      ["hqpweb", "shaper:ASDM7EC"],
    ]);
  });
});

describe("settings last seen in each mode", () => {
  it("remembers the mode left behind, per DAC", async () => {
    await setup();
    await watch();
    await until(caps, (c) => c.lastSeen["SDM (DSD)"]);
    fake.playback = 0; // nothing playing: no pause needed for the switch
    await req("POST", "/api/instances/mac/change", { body: { mode: "PCM" } });
    const c = await until(caps, (x) => x.lastSeen.PCM);
    expect(c.lastSeen).toEqual({
      "SDM (DSD)": expect.objectContaining({ shaper: "AHM7EC8B", filter1x: "poly-sinc-gauss-xla" }),
      PCM: expect.objectContaining({ shaper: expect.any(String) }),
    });
    await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    await req("PUT", "/api/instances/mac/dac", { body: { dac: "desk" } });
    expect(Object.keys((await caps()).lastSeen)).not.toContain("SDM (DSD)");
  });
});

// Measured 2026-10-08 (Desktop 5.35.10, macOS): a mode switch brings back that mode's
// filters and shaping but resets the rate to auto, which in DSD is the highest rate. A
// modulator that kept up at DSD256 then fell behind at DSD1024 and was rolled back, every
// time: no way back into DSD. The mode's last-seen rate goes with the switch.
describe("switching back to a mode", () => {
  it("puts back the rate last used there, not auto", async () => {
    await setup();
    fake.playback = 0; // stopped: no pause step needed
    await watch();
    await req("POST", "/api/instances/mac/change", { body: { shaper: "ASDM7EC", rate: 11_289_600 } });
    await until(caps, (c) => c.lastSeen["SDM (DSD)"]?.rate === 11_289_600);
    await req("POST", "/api/instances/mac/change", { body: { mode: "PCM" } });
    const back = (await req("POST", "/api/instances/mac/change", { body: { mode: "SDM (DSD)" } })).json();
    expect(back.results.map((r: { field: string; actual: unknown }) => [r.field, r.actual])).toEqual([
      ["mode", "SDM (DSD)"],
      ["rate", 11_289_600],
    ]);
    expect(fake.activeRateHz).toBe(11_289_600);
  });

  it("leaves the rate alone when the change names one, or the mode was never seen", async () => {
    await setup();
    fake.playback = 0;
    const r = (await req("POST", "/api/instances/mac/change", { body: { mode: "PCM" } })).json();
    expect(r.results.map((x: { field: string }) => x.field)).toEqual(["mode"]);
  });
});
