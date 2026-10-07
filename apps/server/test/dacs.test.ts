// Named DACs behind one HQPlayer (dac-scope.ts) over the API: answers, learned failures
// and presets follow the DAC in use; everything for the main DAC stays where it was.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile, type FakeOptions } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import { LearnedStore } from "../src/learned.ts";
import type { WatchTiming } from "../src/watch.ts";
import { client } from "./http.ts";

const FAST: WatchTiming = { graceMs: 100, healthyMs: 300, maxMs: 1200, sampleMs: 40, minSpeed: 0.85 };
const fakes: FakeHqp[] = [];
let app: ReturnType<typeof buildApp> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

async function start(fakeOpts: FakeOptions = {}) {
  const f = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0, ...fakeOpts });
  fakes.push(f);
  await f.listen();
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  app = buildApp(
    { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: f.port }] },
    { configDir: dir, pollMs: 50, timing: { quick: FAST, major: FAST }, playWaitMs: 400, learned: new LearnedStore(null) },
  );
  const req = client(await app.listen(0, "127.0.0.1"));
  const view = async () => (await req("GET", "/api/instances")).json()[0];
  const saved = () => JSON.parse(readFileSync(join(dir, "instances.json"), "utf8")).instances[0];
  return { req, view, saved };
}

describe("named DACs over the API", () => {
  it("starts with one unnamed DAC in use, and no picker to show", async () => {
    const { view } = await start();
    expect((await view()).dacs).toEqual([{ id: "main", name: "" }]);
    expect((await view()).dac).toBe("main");
  });

  it("adds a DAC, naming the first one too, without switching to it", async () => {
    const { req, view } = await start();
    const r = await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    expect(r.json().dac).toEqual({ id: "desk", name: "Desk" });
    expect([(await view()).dacs, (await view()).dac]).toEqual([
      [
        { id: "main", name: "Holo" },
        { id: "desk", name: "Desk" },
      ],
      "main",
    ]);
  });

  it("keeps each DAC's answers apart, the main DAC's where they always were", async () => {
    const { req, view, saved } = await start();
    await req("PUT", "/api/instances/mac/setup", { body: { dsd: "direct" } });
    await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    await req("PUT", "/api/instances/mac/dac", { body: { dac: "desk" } });
    expect((await view()).setup).toBeUndefined();
    await req("PUT", "/api/instances/mac/setup", { body: { pcm: "ladder" } });
    expect((await view()).setup).toEqual({ pcm: "ladder" });
    expect([saved().setup, saved().dacs[1].setup, saved().dac]).toEqual([{ dsd: "direct" }, { pcm: "ladder" }, "desk"]);
    await req("PUT", "/api/instances/mac/dac", { body: { dac: "main" } });
    expect((await view()).setup).toEqual({ dsd: "direct" });
  });

  it("falls back to the main DAC when the one in use is removed, and refuses removing main", async () => {
    const { req, view } = await start();
    await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    await req("PUT", "/api/instances/mac/dac", { body: { dac: "desk" } });
    expect((await req("DELETE", "/api/instances/mac/dacs/main")).status).toBe(400);
    await req("DELETE", "/api/instances/mac/dacs/desk");
    expect([(await view()).dac, (await view()).dacs]).toEqual(["main", [{ id: "main", name: "" }]]);
  });

  it("renames a DAC, and refuses one that doesn't exist", async () => {
    const { req, view } = await start();
    await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    await req("PATCH", "/api/instances/mac/dacs/desk", { body: { name: "Office" } });
    expect((await view()).dacs[1]).toEqual({ id: "desk", name: "Office" });
    expect((await req("PUT", "/api/instances/mac/dac", { body: { dac: "nope" } })).status).toBe(404);
  });

  it("learns a failure against the DAC in use, and only that DAC sees it", async () => {
    const { req } = await start({ speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) });
    await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    await req("PUT", "/api/instances/mac/dac", { body: { dac: "desk" } });
    const r = (await req("POST", "/api/instances/mac/change", { body: { filter1x: "poly-sinc-gauss-long" } })).json();
    expect(r.rolledBack).not.toBeNull();
    const bad = async () => (await req("GET", "/api/instances/mac/capabilities")).json().knownBad.length;
    expect(await bad()).toBe(1);
    await req("PUT", "/api/instances/mac/dac", { body: { dac: "main" } });
    expect(await bad()).toBe(0);
  });

  it("refuses switching DAC while a change is running, so its failure lands on the right DAC", async () => {
    const { req, view } = await start({ speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1) });
    await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    const f = fakes[0]!;
    const target = f.lists.filters.find((x) => x.name === "poly-sinc-gauss-long")!.index;
    const change = req("POST", "/api/instances/mac/change", { body: { filter1x: "poly-sinc-gauss-long" } });
    // Once HQPlayer has the new filter, the change is watching playback: still running.
    await expect.poll(() => f.rem.filter1x, { interval: 10 }).toBe(target);
    expect((await req("PUT", "/api/instances/mac/dac", { body: { dac: "desk" } })).status).toBe(409);
    await change;
    expect((await view()).dac).toBe("main");
    expect((await req("PUT", "/api/instances/mac/dac", { body: { dac: "desk" } })).status).toBe(200);
  });
});

describe("presets for one DAC", () => {
  it("keeps a preset for a DAC; names are unique among that DAC's own and the shared ones", async () => {
    const { req } = await start();
    const settings = { shaper: "ASDM7EC" };
    await req("POST", "/api/presets", { body: { name: "Ref", settings, scope: "mac#desk" } });
    expect((await req("POST", "/api/presets", { body: { name: "Ref", settings, scope: "mac" } })).status).toBe(200);
    expect((await req("POST", "/api/presets", { body: { name: "ref", settings, scope: "mac#desk" } })).status).toBe(409);
    expect((await req("POST", "/api/presets", { body: { name: "Ref", settings } })).status).toBe(409);
  });

  it("makes a removed DAC's presets shared ones", async () => {
    const { req } = await start();
    await req("POST", "/api/instances/mac/dacs", { body: { name: "Desk", currentName: "Holo" } });
    await req("POST", "/api/presets", { body: { name: "Desk ref", settings: { shaper: "ASDM7EC" }, scope: "mac#desk" } });
    await req("DELETE", "/api/instances/mac/dacs/desk");
    expect((await req("GET", "/api/presets")).json()[0].scope).toBeUndefined();
  });
});
