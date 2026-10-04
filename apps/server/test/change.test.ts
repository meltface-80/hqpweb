import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile, type FakeOptions } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import type { InstanceConfig } from "../src/config.ts";
import { LearnedStore } from "../src/learned.ts";
import type { WatchTiming } from "../src/watch.ts";
import { client } from "./http.ts";

const FAST: WatchTiming = { graceMs: 100, healthyMs: 300, maxMs: 1200, sampleMs: 40, minSpeed: 0.85 };
const timing = { quick: FAST, major: { ...FAST, maxMs: 1500 } };

let fake: FakeHqp;
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;
let base: string;

async function setup(fakeOpts: FakeOptions = {}, extra: Partial<InstanceConfig> = {}, learned?: LearnedStore) {
  fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0, ...fakeOpts });
  await fake.listen();
  app = buildApp(
    { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port, ...extra }] },
    { pollMs: 50, timing, playWaitMs: 400, ...(learned ? { learned } : {}) },
  );
  base = await app.listen(0, "127.0.0.1");
  req = client(base);
}
afterEach(async () => {
  await app.close();
  await fake.close();
});

const change = (body: object) => req("POST", "/api/instances/mac/change", { body });
const undo = () => req("POST", "/api/instances/mac/undo");
const caps = async () => (await req("GET", "/api/instances/mac/capabilities")).json();

describe("capabilities", () => {
  it("returns the current mode's lists and volume range", async () => {
    await setup();
    const r = await caps();
    expect(r.mode.name).toBe("SDM (DSD)");
    expect(r.filters).toHaveLength(77);
    expect(r.shapers).toHaveLength(36);
    expect(r.volumeRange).toMatchObject({ min: -60, max: -3 });
    expect(r.rates.every((x: { allowed: boolean }) => x.allowed)).toBe(true);
  });

  it("follows a mode change made elsewhere", async () => {
    await setup();
    await caps();
    fake.modeIndex = 1; // PCM, as if changed from HQPlayer's own UI
    expect((await caps()).shapers).toHaveLength(10);
  });

  it("marks rates above a configured limit as not allowed", async () => {
    await setup({}, { limits: { maxPcmRate: 384000 } });
    fake.modeIndex = 1;
    const rates = (await caps()).rates as { rate: number; allowed: boolean }[];
    expect(rates.filter((r) => !r.allowed).map((r) => r.rate)).toEqual([705600, 768000, 1411200, 1536000]);
  });
});

describe("quick changes", () => {
  it("resolves names, applies, verifies, and confirms playback", async () => {
    await setup();
    const body = (await change({ filterNx: "poly-sinc-gauss-long", shaper: "ASDM7EC" })).json();
    expect(body.class).toBe("quick");
    expect(body.results).toEqual([
      expect.objectContaining({ field: "filterNx", actual: "poly-sinc-gauss-long", applied: true }),
      expect.objectContaining({ field: "shaper", actual: "ASDM7EC", applied: true }),
    ]);
    expect(body.playback).toEqual({ kind: "playing" });
    expect(body.state.filter1x).toBe(49); // carried over untouched
  });

  it("doesn't watch playback for volume or toggles", async () => {
    await setup();
    const body = (await change({ volume: -30, invert: true })).json();
    expect(body.playback.kind).toBe("not-checked");
  });

  it("says so when nothing was playing", async () => {
    await setup();
    fake.playback = 0;
    const body = (await change({ filterNx: "poly-sinc-gauss-long" })).json();
    expect(body.playback).toMatchObject({ kind: "not-checked", detail: expect.stringMatching(/nothing was playing/) });
  });

  it("reports applied=false when the reply says OK but nothing changed", async () => {
    await setup();
    fake.ignore.add("SetShaping");
    const body = (await change({ shaper: "ASDM7EC" })).json();
    expect(body.results[0]).toMatchObject({ applied: false, actual: "AHM7EC8B", reply: { kind: "ok" } });
  });

  it("rejects names that don't exist in the current mode, and applies nothing", async () => {
    await setup();
    const r = await change({ shaper: "NS5", filterNx: "poly-sinc-gauss-long" });
    expect(r.status).toBe(422);
    expect(r.json().error).toMatch(/NS5.*SDM/);
    expect(fake.rem.filterNx).toBe(51);
  });

  it("rejects unknown fields, wrong types and empty bodies", async () => {
    await setup();
    expect((await change({})).status).toBe(400);
    expect((await change({ bogus: 1 })).status).toBe(400);
    expect((await change({ volume: "-20" })).status).toBe(400);
    expect((await change({ rate: 44100.5 })).status).toBe(400);
  });
});

describe("rollback when playback fails", () => {
  it("rolls back the measured stall (AHM7EC8B at DSD512) and explains it without learning", async () => {
    const learnedPath = join(mkdtempSync(join(tmpdir(), "learned-")), "learned.json");
    await setup({}, {}, new LearnedStore(learnedPath));
    const body = (await change({ rate: 22579200 })).json();
    expect(body.class).toBe("major");
    expect(body.results[0]).toMatchObject({ field: "rate", actual: 22579200, applied: true });
    expect(body.playback.kind).toBe("stopped");
    expect(body.rolledBack.results[0]).toMatchObject({ field: "rate", actual: 0, applied: true });
    expect(body.rolledBack.playback).toEqual({ kind: "playing" });
    expect(body.undoAvailable).toBe(false);
    expect(fake.playback).toBe(2);

    expect(body.incompatible).toMatchObject({ level: "hard", text: expect.stringMatching(/AHM7EC8B needs/) });
    expect((await caps()).knownBad).toEqual([]);
    expect(() => readFileSync(learnedPath, "utf8")).toThrow(); // nothing learned, nothing written
  });

  it("learns an unexplained failure (overload) and persists it", async () => {
    const learnedPath = join(mkdtempSync(join(tmpdir(), "learned-")), "learned.json");
    await setup(
      { speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) },
      {},
      new LearnedStore(learnedPath),
    );
    const body = (await change({ filter1x: "poly-sinc-gauss-long" })).json();
    expect(body.incompatible).toBeUndefined();
    expect((await caps()).knownBad).toEqual([expect.objectContaining({ filter1x: "poly-sinc-gauss-long", rateHz: 45158400 })]);
    expect(JSON.parse(readFileSync(learnedPath, "utf8")).failures).toHaveLength(1);
  });

  it("rolls back a rule-explained stop without learning it (sinc-M, 44.1k → 192k)", async () => {
    await setup();
    await change({ mode: "PCM" }); // 44.1 kHz source, so the 1x filter is in use
    await change({ filter1x: "sinc-M", rate: 176400 }); // 4×: fine
    const body = (await change({ rate: 192000 })).json(); // 4.35×: can't
    expect(body.playback.kind).toBe("stopped");
    expect(body.incompatible).toMatchObject({ level: "hard", text: expect.stringMatching(/power-of-two/) });
    expect(body.rolledBack.results[0]).toMatchObject({ field: "rate", actual: 176400, applied: true });
    expect((await req("GET", "/api/instances/mac/learned")).json()).toEqual([]);
  });

  it("rolls back a filter the machine can't keep up with", async () => {
    await setup({ speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) });
    // 44.1 kHz source: the 1x filter is the one in use.
    const body = (await change({ filter1x: "poly-sinc-gauss-long" })).json();
    expect(body.playback).toMatchObject({ kind: "struggling" });
    expect(body.rolledBack.results[0]).toMatchObject({ field: "filter1x", actual: "poly-sinc-gauss-xla", applied: true });
    expect(body.rolledBack.playback).toEqual({ kind: "playing" });
    expect((await caps()).knownBad[0]).toMatchObject({ filter1x: "poly-sinc-gauss-long" });
  });

  it("lists learned failures and forgets them", async () => {
    await setup({ speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) });
    await change({ filter1x: "poly-sinc-gauss-long" }); // simulated overload
    const list = (await req("GET", "/api/instances/mac/learned")).json();
    expect(list).toHaveLength(1);
    expect((await req("DELETE", "/api/instances/mac/learned")).json()).toEqual({ forgotten: 1 });
    expect((await caps()).knownBad).toEqual([]);
  });

  it("still rolls back when the learned store can't be written", async () => {
    // A path whose parent is a file: mkdir and write both fail.
    const dir = mkdtempSync(join(tmpdir(), "learned-"));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "blocker"), "");
    await setup({}, {}, new LearnedStore(join(dir, "blocker", "learned.json")));
    const body = (await change({ rate: 22579200 })).json();
    expect(body.playback.kind).toBe("stopped");
    expect(body.rolledBack.results[0]).toMatchObject({ field: "rate", actual: 0, applied: true });
    expect(fake.playback).toBe(2);
  });

  it("keeps a valid combination (ASDM7EC at DSD512)", async () => {
    await setup();
    await change({ shaper: "ASDM7EC" });
    const body = (await change({ rate: 22579200 })).json();
    expect(body.playback).toEqual({ kind: "playing" });
    expect(body.rolledBack).toBeNull();
  });
});

describe("mode and rate", () => {
  it("switches mode, and undo restores mode, rate and that mode's filters", async () => {
    await setup();
    await change({ shaper: "ASDM7EC" });
    await change({ rate: 22579200 });
    const toPcm = (await change({ mode: "PCM" })).json();
    expect(toPcm.class).toBe("major");
    expect(toPcm.results[0]).toMatchObject({ field: "mode", actual: "PCM", applied: true });
    expect(toPcm.playback).toEqual({ kind: "playing" });

    const back = (await undo()).json();
    expect(back.state).toMatchObject({ mode: 2, rate: 4 }); // SDM, DSD512
    expect(fake.shaperName).toBe("ASDM7EC");
  });

  it("applies mode, then resolves the other fields against the new mode's lists", async () => {
    await setup();
    const body = (await change({ mode: "PCM", shaper: "NS5", rate: 384000 })).json();
    expect(body.results.map((r: { applied: boolean }) => r.applied)).toEqual([true, true, true]);
  });

  it("restores the mode if a later field can't be resolved", async () => {
    await setup();
    const r = await change({ mode: "PCM", shaper: "AHM7EC8B" }); // a modulator, not a PCM dither
    expect(r.status).toBe(422);
    expect(fake.mode.name).toBe("SDM (DSD)");
  });

  it("refuses a rate above the configured limit", async () => {
    await setup({}, { limits: { maxPcmRate: 384000 } });
    const r = await change({ mode: "PCM", rate: 768000 });
    expect(r.status).toBe(422);
    expect(r.json().error).toMatch(/limit/);
    expect(fake.mode.name).toBe("SDM (DSD)");
  });

  it("refuses rates in [source] mode", async () => {
    await setup();
    const r = await change({ mode: "[source]", rate: 44100 });
    expect(r.status).toBe(422);
  });
});

describe("volume safety", () => {
  it("lowers freely, as a float", async () => {
    await setup();
    expect((await change({ volume: -40.5 })).json().results[0]).toMatchObject({ applied: true, actual: -40.5 });
  });

  it("refuses a raise of more than 6 dB in one step", async () => {
    await setup();
    expect((await change({ volume: -10 })).status).toBe(422);
    expect(fake.volume).toBe(-22);
  });

  it("allows a raise of up to 6 dB", async () => {
    await setup();
    expect((await change({ volume: -16 })).json().results[0].applied).toBe(true);
  });

  it("a rollback restores the filter but never raises the volume (design §7: no implicit raise)", async () => {
    await setup({ speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) });
    const body = (await change({ filter1x: "poly-sinc-gauss-long", volume: -30 })).json();
    expect(body.rolledBack.results).toContainEqual(expect.objectContaining({ field: "filter1x", actual: "poly-sinc-gauss-xla" }));
    expect(body.rolledBack.results).toContainEqual(
      expect.objectContaining({ field: "volume", applied: false, actual: -30, note: expect.stringMatching(/never raises/) }),
    );
    expect(fake.volume).toBe(-30);
  });

  it("a rollback still lowers a volume the change raised", async () => {
    await setup({ speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) });
    await change({ filter1x: "poly-sinc-gauss-long", volume: -18 });
    expect(fake.volume).toBe(-22);
  });

  it("clamps to VolumeRange.max and says so", async () => {
    await setup();
    fake.volume = -5;
    const res = (await change({ volume: 0 })).json().results[0];
    expect(res).toMatchObject({ actual: -3, applied: true });
    expect(res.note).toMatch(/clamped to -3/);
  });
});

describe("undo", () => {
  it("restores exactly the fields the last change touched", async () => {
    await setup();
    await change({ filter1x: "poly-sinc-gauss-long", volume: -30 });
    const body = (await undo()).json();
    expect(body.state).toMatchObject({ filter1x: 49, filterNx: 51, volume: -22 });
    expect(body.undoAvailable).toBe(false);
  });

  it("does not raise volume past the guard if it was changed elsewhere since", async () => {
    await setup();
    await change({ volume: -40 });
    fake.volume = -45; // e.g. lowered from Roon
    const body = (await undo()).json();
    expect(body.results[0]).toMatchObject({ field: "volume", applied: false });
    expect(body.results[0].note).toMatch(/not restored/);
    expect(fake.volume).toBe(-45);
  });

  it("refuses after a mode change made elsewhere", async () => {
    await setup();
    await change({ shaper: "ASDM7EC" });
    fake.modeIndex = 1;
    expect((await undo()).status).toBe(409);
  });

  it("has nothing to undo at first", async () => {
    await setup();
    expect((await undo()).status).toBe(409);
  });
});

describe("events", () => {
  it("streams status snapshots", async () => {
    await setup();
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/instances/mac/events`, { signal: ctl.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: now")) text += new TextDecoder().decode((await reader.read()).value);
    ctl.abort();
    const data = JSON.parse(text.split("event: now\ndata: ")[1]!.split("\n")[0]!);
    expect(data.status.activeShaper).toBe("AHM7EC8B");
  });

  it("404s for an unknown instance", async () => {
    await setup();
    expect((await req("GET", "/api/instances/nope/events")).status).toBe(404);
  });
});

describe("convolution and matrix profiles", () => {
  it("reports convolution as not applied, with the reason, when HQPlayer has none set up", async () => {
    await setup();
    const r = (await change({ convolution: true })).json();
    expect(r.results[0]).toMatchObject({ field: "convolution", applied: false, actual: false, reply: { kind: "ok" } });
    expect(r.results[0].note).toMatch(/no impulse responses are set up/);
  });

  it("toggles convolution when it is set up", async () => {
    await setup({ convolutionConfigured: true });
    const r = (await change({ convolution: true })).json();
    expect(r.results[0]).toMatchObject({ applied: true, actual: true });
    expect(r.playback.kind).toBe("playing"); // treated as risky: watched
  });

  it("switches to a listed matrix profile and verifies it", async () => {
    await setup({ matrixProfiles: ["Headphones", "Room EQ"] });
    expect((await caps()).matrixProfiles).toEqual(["Headphones", "Room EQ"]);
    const r = (await change({ matrixProfile: "Room EQ" })).json();
    expect(r.results[0]).toMatchObject({ field: "matrixProfile", applied: true, actual: "Room EQ" });
  });

  it("never sends an unknown profile name (HQPlayer would say OK anyway)", async () => {
    await setup({ matrixProfiles: ["Headphones"] });
    const r = await change({ matrixProfile: "Nope" });
    expect(r.status).toBe(422);
    expect(fake.matrixProfile).toBe("");
    expect(fake.received.some((x) => x.includes("MatrixSetProfile"))).toBe(false);
  });

  it("says when no profiles are set up at all", async () => {
    await setup();
    expect((await change({ matrixProfile: "Anything" })).json().error).toMatch(/no matrix profiles are set up/);
  });
});

describe("HQPlayer-side seek", () => {
  it("jumps within HQPlayer's own file, and passes on a refusal for a stream", async () => {
    await setup();
    // The fake starts with Roon as the source: a stream, so seeking is refused.
    const refused = await req("POST", "/api/instances/mac/seek", { body: { seconds: 120 } });
    expect(refused.status).toBe(409);
    expect(refused.json().error).toMatch(/can't seek/);
    // HQPlayer playing its own file: the seek lands.
    fake.feeder = "playlist";
    const ok = await req("POST", "/api/instances/mac/seek", { body: { seconds: 120 } });
    expect(ok.status).toBe(200);
    expect(ok.json().status.position).toBeGreaterThanOrEqual(120);
    expect((await req("POST", "/api/instances/mac/seek", { body: { seconds: -1 } })).status).toBe(400);
  });
});

describe("Play that doesn't start", () => {
  it("says so when no rule explains it (e.g. an output that isn't there)", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0, incompatible: () => true });
    fake.playback = 0;
    await fake.listen();
    app = buildApp(
      { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] },
      { pollMs: 50, timing, playWaitMs: 400 },
    );
    base = await app.listen(0, "127.0.0.1");
    req = client(base);
    const r = (await req("POST", "/api/instances/mac/transport", { body: { action: "play" } })).json();
    expect(r.status.state).toBe(0);
    expect(r.notStarted).toEqual({});
  });

  it("names the rule when one explains it (a queued 48k track at a fixed rate sinc-M can't do)", async () => {
    await setup({}, {}, undefined);
    // DSD1024 (the profile's AHM modulator needs it); 44.1k → DSD1024 is 1024×, fine.
    expect((await change({ filter1x: "sinc-M", rate: 45_158_400 })).json().rolledBack).toBeFalsy();
    await req("POST", "/api/instances/mac/transport", { body: { action: "stop" } });
    fake.feeder = "playlist";
    fake.playlist = ["/music/Example Artist/First Album/01 - Opening.flac"];
    fake.setSource(48_000); // 48k → DSD1024 (44.1k family) is 940.8×: not a power of two
    const r = (await req("POST", "/api/instances/mac/transport", { body: { action: "play" } })).json();
    expect(r.status.state).toBe(0);
    expect(r.notStarted.explained).toMatch(/sinc-M needs a power-of-two ratio/);
  });
});

describe("live health in the status stream", () => {
  async function events(n: number, pred: (d: any) => boolean) {
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/instances/mac/events`, { signal: ctl.signal });
    const reader = res.body!.getReader();
    let text = "";
    for (;;) {
      text += new TextDecoder().decode((await reader.read()).value);
      const datas = [...text.matchAll(/event: now\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]!));
      const hit = datas.find(pred);
      if (hit || datas.length >= n) {
        ctl.abort();
        return hit;
      }
    }
  }

  it("reports latency and real-time speed while playing", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    await fake.listen();
    app = buildApp(
      { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] },
      { pollMs: 50, speedWindowMs: 400 },
    );
    base = await app.listen(0, "127.0.0.1");
    const d = await events(40, (x) => x.health?.speed != null);
    expect(d.health.latencyMs).toBeLessThan(1000);
    expect(d.health.speed).toBeGreaterThan(0.8);
  });

  it("passes HQPlayer's own processing speed through, averaged (×real time)", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    await fake.listen();
    app = buildApp({ instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] }, { pollMs: 50 });
    base = await app.listen(0, "127.0.0.1");
    const d = await events(20, (x) => x.health?.processSpeed != null);
    expect(d?.health.processSpeed).toBe(25);
  });

  it("while stopped, reports the queued track's rate (a track that can't start leaves Status blank)", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    fake.playback = 0;
    fake.feeder = "playlist";
    await fake.listen();
    app = buildApp(
      { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] },
      { pollMs: 50, queueEveryMs: 100 },
    );
    base = await app.listen(0, "127.0.0.1");
    // A playlist that was there before hqpweb started isn't trusted (it may be left over).
    await events(20, (x) => x.queuedRate === null);
    fake.playlist = ["/music/Example Artist/First Album/01 - Opening.flac"];
    fake.setSource(96_000);
    const d = await events(200, (x) => x.queuedRate === 96_000);
    expect(d?.status.source).toBeNull();
    expect(d?.queuedRate).toBe(96_000);
  });

  it("doesn't trust HQPlayer's playlist after Roon was the source", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    fake.playlist = ["/music/Example Artist/First Album/01 - Opening.flac"];
    await fake.listen(); // playing, fed by Roon
    app = buildApp({ instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] }, { pollMs: 50 });
    base = await app.listen(0, "127.0.0.1");
    await events(20, (x) => x.status.source?.song === "Roon");
    fake.playback = 0;
    const d = await events(40, (x) => x.status.state === 0 && x.queuedRate !== undefined);
    expect(d?.queuedRate).toBeNull();
  });

  it("trusts the playlist again once something new is queued after Roon", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    fake.playlist = ["/music/Example Artist/First Album/01 - Opening.flac"];
    await fake.listen();
    app = buildApp(
      { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] },
      { pollMs: 50, queueEveryMs: 100 },
    );
    base = await app.listen(0, "127.0.0.1");
    await events(20, (x) => x.status.source?.song === "Roon");
    fake.playback = 0;
    await events(40, (x) => x.status.state === 0 && x.queuedRate === null);
    fake.playlist = ["/music/Example Artist/Second Album/01 - Intro.flac"];
    fake.setSource(88_200);
    const d = await events(400, (x) => x.queuedRate === 88_200);
    expect(d?.queuedRate).toBe(88_200);
  });

  it("flags a volume jump hqpweb didn't make (a restart comes back at −3 dB), until dismissed", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    await fake.listen();
    app = buildApp({ instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] }, { pollMs: 50 });
    base = await app.listen(0, "127.0.0.1");
    req = client(base);
    fake.volume = -44;
    await events(20, (x) => x.state.volume === -44);
    fake.volume = -3; // as after a restart
    const d = await events(40, (x) => x.volumeJump);
    expect(d?.volumeJump).toMatchObject({ from: -44, to: -3 });
    await req("POST", "/api/instances/mac/dismissjump");
    const after = await events(40, (x) => x.state.volume === -3 && !x.volumeJump);
    expect(after?.volumeJump).toBeUndefined();
  });

  it("passes HQPlayer's apodization and clip counters through", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    fake.apod = 12;
    fake.clips = 3;
    await fake.listen();
    app = buildApp({ instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] }, { pollMs: 50 });
    base = await app.listen(0, "127.0.0.1");
    const d = await events(20, (x) => x.status.apod > 0);
    expect(d?.status).toMatchObject({ apod: 12, clips: 3 });
  });

  it("shows an overloaded machine's processing speed below 1×", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0, speed: () => 0.6 });
    await fake.listen();
    app = buildApp({ instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] }, { pollMs: 50 });
    base = await app.listen(0, "127.0.0.1");
    const d = await events(20, (x) => x.health?.processSpeed != null);
    expect(d?.health.processSpeed).toBeLessThan(1);
  });

  it("still reports speed when polls are spaced widely (as when polling backs off)", async () => {
    // Regression: the trail was cut to exactly the window but had to span 90% of it,
    // so polls spaced more than 10% of the window apart never produced a reading.
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    await fake.listen();
    app = buildApp(
      { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] },
      { pollMs: 150, speedWindowMs: 400 },
    );
    base = await app.listen(0, "127.0.0.1");
    const d = await events(20, (x) => x.health?.speed != null);
    expect(d?.health.speed).toBeGreaterThan(0.8);
  });

  it("shows an instance falling behind (simulated overload)", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0, speed: () => 0.5 });
    await fake.listen();
    app = buildApp(
      { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] },
      { pollMs: 50, speedWindowMs: 400 },
    );
    base = await app.listen(0, "127.0.0.1");
    const d = await events(40, (x) => x.health?.speed != null);
    expect(d.health.speed).toBeLessThan(0.7);
  });
});

describe("undo of a matrix profile change", () => {
  it("restores 'no profile' (empty name) on undo", async () => {
    await setup({ matrixProfiles: ["Headphones"] });
    await change({ matrixProfile: "Headphones" });
    const r = (await undo()).json();
    expect(r.results[0]).toMatchObject({ field: "matrixProfile", applied: true, actual: "" });
  });
});

describe("transport", () => {
  const t = (action: unknown) => req("POST", "/api/instances/mac/transport", { body: { action } });
  it("pauses, plays, stops and skips, reporting the resulting status", async () => {
    await setup();
    expect((await t("pause")).json().status.state).toBe(1);
    expect((await t("play")).json().status.state).toBe(2);
    const n = (await t("next")).json();
    expect(n.reply).toEqual({ kind: "ok" });
    expect(n.status.position).toBeLessThan(1);
    expect((await t("stop")).json().status.state).toBe(0);
  });
  it("rejects unknown actions", async () => {
    await setup();
    expect((await t("eject")).status).toBe(400);
    expect((await req("POST", "/api/instances/mac/transport", { body: {} })).status).toBe(400);
  });
});
