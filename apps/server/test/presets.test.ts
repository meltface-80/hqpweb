import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import { PresetStore } from "../src/presets.ts";
import type { WatchTiming } from "../src/watch.ts";
import { client } from "./http.ts";

const FAST: WatchTiming = { graceMs: 100, healthyMs: 300, maxMs: 1200, sampleMs: 40, minSpeed: 0.85 };

let mac: FakeHqp;
let linux: FakeHqp;
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;

async function setup(store = new PresetStore(null)) {
  mac = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
  linux = new FakeHqp(loadProfile("desktop5-linux-pcm"), { timeScale: 0 });
  await mac.listen();
  await linux.listen();
  linux.playback = 2;
  app = buildApp(
    {
      instances: [
        { id: "mac", name: "Mac", host: "127.0.0.1", port: mac.port },
        { id: "linux", name: "Linux", host: "127.0.0.1", port: linux.port },
      ],
    },
    { presets: store, timing: { quick: FAST, major: { ...FAST, maxMs: 1500 } } },
  );
  req = client(await app.listen(0, "127.0.0.1"));
}
afterEach(async () => {
  await app.close();
  await mac.close();
  await linux.close();
});

const save = (body: object) => req("POST", "/api/presets", { body });
const previews = async (inst: string) => (await req("GET", `/api/instances/${inst}/presets`)).json();
const apply = (inst: string, id: string) => req("POST", `/api/instances/${inst}/presets/${id}/apply`);

describe("saving presets", () => {
  it("captures the full current settings by name, without volume by default", async () => {
    await setup();
    const p = (await save({ name: "LR DSD1024", fromInstance: "mac" })).json();
    expect(p.settings).toEqual({
      mode: "SDM (DSD)",
      rate: 0,
      filterNx: "poly-sinc-gauss-hires-lp",
      filter1x: "poly-sinc-gauss-xla",
      shaper: "AHM7EC8B",
      invert: false,
      filter20k: false,
      adaptive: false,
      convolution: false,
    });
  });

  it("includes volume only when asked", async () => {
    await setup();
    const p = (await save({ name: "With volume", fromInstance: "mac", includeVolume: true })).json();
    expect(p.settings.volume).toBe(-22);
  });

  it("accepts explicit settings, validated like a change", async () => {
    await setup();
    expect((await save({ name: "Just a filter", settings: { filter1x: "poly-sinc-gauss-long" } })).status).toBe(200);
    expect((await save({ name: "Bad", settings: { volume: "-20" } })).status).toBe(400);
    expect((await save({ name: "Empty", settings: {} })).status).toBe(400);
    expect((await save({ settings: { invert: true } })).status).toBe(400); // name required
  });

  it("rejects duplicate names, case-insensitively", async () => {
    await setup();
    await save({ name: "Night", settings: { invert: true } });
    expect((await save({ name: "night", settings: { invert: false } })).status).toBe(409);
  });

  it("renames, deletes and persists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "presets-"));
    await setup(new PresetStore(join(dir, "presets.json")));
    const p = (await save({ name: "A", settings: { invert: true } })).json();
    expect((await req("PATCH", `/api/presets/${p.id}`, { body: { name: "B" } })).json().name).toBe("B");
    expect(JSON.parse(readFileSync(join(dir, "presets.json"), "utf8")).presets[0].name).toBe("B");
    expect((await req("DELETE", `/api/presets/${p.id}`)).status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "presets.json"), "utf8")).presets).toEqual([]);
    expect((await req("DELETE", `/api/presets/${p.id}`)).status).toBe(404);
  });
});

describe("previews", () => {
  it("classifies active, quick and major", async () => {
    await setup();
    await save({ name: "Current", fromInstance: "mac" });
    await save({ name: "Other filter", settings: { filter1x: "poly-sinc-gauss-long" } });
    await save({ name: "PCM", settings: { mode: "PCM" } });
    const kinds = (await previews("mac")).map((p: { name: string; preview: { kind: string } }) => [p.name, p.preview.kind]);
    expect(kinds).toEqual([
      ["Current", "active"],
      ["Other filter", "quick"],
      ["PCM", "major"],
    ]);
  });

  it("lists what another instance can't take", async () => {
    await setup();
    await save({ name: "LR", fromInstance: "mac" }); // SDM preset
    await save({ name: "Mod only", settings: { shaper: "AHM7EC8B" } });
    const [lr, mod] = await previews("linux"); // PCM-only box
    expect(lr.preview.missing.map((m: { field: string }) => m.field)).toEqual(["mode", "rate", "filterNx", "filter1x", "shaper"]);
    expect(lr.preview.missing[0]).toEqual({ field: "mode", reason: 'mode "SDM (DSD)" is not available here' });
    expect(mod.preview.missing).toEqual([{ field: "shaper", reason: '"AHM7EC8B" isn\'t available here' }]);
  });

  it("predicts a rule-explained stop before applying", async () => {
    await setup();
    await save({ name: "sinc-M at 192k", settings: { filter1x: "sinc-M", rate: 192000 } });
    const [p] = await previews("linux"); // PCM, 44.1 kHz source, 1x slot
    expect(p.preview.predicted).toMatchObject({ level: "hard", text: expect.stringMatching(/power-of-two/) });
  });
});

describe("applying", () => {
  it("applies a quick preset with read-back and a playback check", async () => {
    await setup();
    const p = (await save({ name: "Gauss long", settings: { filter1x: "poly-sinc-gauss-long", invert: true } })).json();
    const r = (await apply("mac", p.id)).json();
    expect(r.class).toBe("quick");
    expect(r.results.every((x: { applied: boolean }) => x.applied)).toBe(true);
    expect(r.playback).toEqual({ kind: "playing" });
    expect(r.skipped).toBeUndefined();
  });

  it("applies what it can on another instance and reports the rest", async () => {
    await setup();
    const p = (
      await save({ name: "Mixed", settings: { filter1x: "poly-sinc-gauss-long", shaper: "AHM7EC8B", invert: true } })
    ).json();
    const r = (await apply("linux", p.id)).json();
    expect(r.results.map((x: { field: string }) => x.field)).toEqual(["filter1x", "invert"]);
    expect(r.skipped).toEqual([{ field: "shaper", reason: expect.stringMatching(/AHM7EC8B.*not available in PCM/) }]);
  });

  it("switches mode first and resolves names against the new mode", async () => {
    await setup();
    const p = (
      await save({ name: "PCM 384", settings: { mode: "PCM", rate: 384000, shaper: "NS5", filter1x: "poly-sinc-gauss-long" } })
    ).json();
    const r = (await apply("mac", p.id)).json();
    expect(r.class).toBe("major");
    expect(r.results.every((x: { applied: boolean }) => x.applied)).toBe(true);
    expect(mac.mode.name).toBe("PCM");
  });

  it("never raises volume past the guard; skips it instead", async () => {
    await setup();
    const p = (await save({ name: "Loud", settings: { volume: -5, invert: true } })).json(); // from -22
    const r = (await apply("mac", p.id)).json();
    expect(r.skipped).toEqual([{ field: "volume", reason: expect.stringMatching(/refusing to raise volume by 17\.0 dB/) }]);
    expect(mac.volume).toBe(-22);
    expect(mac.invert).toBe(true);
  });

  it("rolls back a preset that a rule says can't play, without learning it", async () => {
    await setup();
    const p = (await save({ name: "sinc-M 192k", settings: { filter1x: "sinc-M", rate: 192000 } })).json();
    const r = (await apply("linux", p.id)).json();
    expect(r.playback.kind).toBe("stopped");
    expect(r.incompatible).toMatchObject({ level: "hard" });
    expect(r.rolledBack.results.every((x: { applied: boolean }) => x.applied)).toBe(true);
    expect((await req("GET", "/api/instances/linux/learned")).json()).toEqual([]);
  });

  it("404s for unknown presets and instances", async () => {
    await setup();
    expect((await apply("mac", "nope")).status).toBe(404);
    expect((await req("GET", "/api/instances/nope/presets")).status).toBe(404);
  });
});

describe("store robustness", () => {
  it("moves a corrupt presets.json aside instead of overwriting it", async () => {
    const { writeFileSync, readdirSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "presets-"));
    writeFileSync(join(dir, "presets.json"), '{"presets": [ {"id":"a","name":"x",} ]}'); // trailing comma
    const store = new PresetStore(join(dir, "presets.json"));
    expect(store.list()).toEqual([]);
    store.create("New", { invert: true });
    expect(readdirSync(dir).some((f) => f.startsWith("presets.json.corrupt-"))).toBe(true);
  });

  it("drops individual invalid entries and keeps the rest", async () => {
    const { writeFileSync } = await import("node:fs");
    const { parseChange } = await import("../src/app.ts");
    const dir = mkdtempSync(join(tmpdir(), "presets-"));
    writeFileSync(
      join(dir, "presets.json"),
      JSON.stringify({
        presets: [
          { id: "a", name: "Good", settings: { invert: true } },
          { id: "b", name: "Bad", settings: { volume: "loud" } },
        ],
      }),
    );
    expect(new PresetStore(join(dir, "presets.json"), parseChange).list().map((p) => p.name)).toEqual(["Good"]);
  });
});

describe("mode-bound settings", () => {
  it("skips a missing mode's rate/filters/modulator, and the preview says so", async () => {
    await setup();
    const p = (
      await save({
        name: "LR",
        settings: { mode: "SDM (DSD)", rate: 22579200, filter1x: "poly-sinc-gauss-xla", shaper: "ASDM7EC", invert: true },
      })
    ).json();
    const [pv] = await previews("linux");
    expect(pv.preview.missing.map((m: { field: string }) => m.field)).toEqual(["mode", "rate", "filter1x", "shaper"]);
    const r = (await apply("linux", p.id)).json();
    expect(r.results.map((x: { field: string }) => x.field)).toEqual(["invert"]);
    expect(r.skipped.map((x: { field: string }) => x.field)).toEqual(["mode", "rate", "filter1x", "shaper"]);
    expect(linux.rateIndex).toBe(0); // untouched
  });
});

describe("update from current", () => {
  it("replaces a preset's settings with the instance's current ones, keeping its volume choice", async () => {
    await setup();
    const p = (await save({ name: "Mine", fromInstance: "mac" })).json();
    await req("POST", "/api/instances/mac/change", { body: { filter1x: "poly-sinc-gauss-long" } });
    const u = (await req("PATCH", `/api/presets/${p.id}`, { body: { fromInstance: "mac" } })).json();
    expect(u.settings.filter1x).toBe("poly-sinc-gauss-long");
    expect(u.settings.volume).toBeUndefined();
    const [pv] = await previews("mac");
    expect(pv.preview.kind).toBe("active");
  });
});
