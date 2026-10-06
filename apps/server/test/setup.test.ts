// An instance's setup answers (config.ts, InstanceSetup): validation, saving, and
// saving a discovered instance on the way.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import { applySetupChange, parseSetupChange } from "../src/setup.ts";
import { client } from "./http.ts";

describe("setup answers: what a change may contain", () => {
  it("rejects a question it doesn't know", () => {
    expect(() => parseSetupChange({ dac: "direct" })).toThrow(/unknown setup question "dac"/);
  });

  it("rejects an answer that isn't one of the question's choices", () => {
    expect(() => parseSetupChange({ dsd: "seventh" })).toThrow(/dsd must be one of older-ess, remodulates, direct, converts/);
  });

  it("accepts null, which clears an answer", () => {
    expect(parseSetupChange({ pcm: null, link: "spdif" })).toEqual({ pcm: null, link: "spdif" });
  });

  it("accepts the amplifier, fixed-volume and I2S answers", () => {
    expect(parseSetupChange({ amp: "class-d-or-tube", volume: "fixed", link: "i2s" })).toEqual({
      amp: "class-d-or-tube",
      volume: "fixed",
      link: "i2s",
    });
  });

  it("sets and clears answers, leaving the others alone", () => {
    expect(applySetupChange({ dsd: "direct", pcm: "ladder" }, { pcm: null, volume: "hqplayer" })).toEqual({
      dsd: "direct",
      volume: "hqplayer",
    });
  });

  it("has no setup at all once every answer is cleared", () => {
    expect(applySetupChange({ dsd: "direct" }, { dsd: null })).toBeUndefined();
  });
});

describe("setup answers over the API", () => {
  const fakes: FakeHqp[] = [];
  let app: ReturnType<typeof buildApp> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    await Promise.all(fakes.splice(0).map((f) => f.close()));
  });
  async function start(instances: { id: string; name: string; host: string; port: number }[], discover = false) {
    const f = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    fakes.push(f);
    await f.listen();
    const discoveryPort = discover ? await f.listenDiscovery(0) : 0;
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    app = buildApp(
      { instances: instances.map((i) => ({ ...i, port: i.port || f.port })) },
      {
        configDir: dir,
        discoveredPort: f.port,
        ...(discover ? { discovery: { target: { address: "127.0.0.1", port: discoveryPort }, timeoutMs: 200 } } : {}),
      },
    );
    const req = client(await app.listen(0, "127.0.0.1"));
    const saved = () => JSON.parse(readFileSync(join(dir, "instances.json"), "utf8")).instances;
    return { req, saved };
  }

  it("saves answers on a configured instance, in instances.json", async () => {
    const { req, saved } = await start([{ id: "mac", name: "Mac", host: "127.0.0.1", port: 0 }]);
    await req("PUT", "/api/instances/mac/setup", { body: { dsd: "direct", volume: "hqplayer" } });
    expect(saved()[0].setup).toEqual({ dsd: "direct", volume: "hqplayer" });
  });

  it("shows the answers in the instance list", async () => {
    const { req } = await start([{ id: "mac", name: "Mac", host: "127.0.0.1", port: 0 }]);
    await req("PUT", "/api/instances/mac/setup", { body: { pcm: "ladder" } });
    expect((await req("GET", "/api/instances")).json()[0].setup).toEqual({ pcm: "ladder" });
  });

  it("says it didn't need to save the instance when it was already configured", async () => {
    const { req } = await start([{ id: "mac", name: "Mac", host: "127.0.0.1", port: 0 }]);
    expect((await req("PUT", "/api/instances/mac/setup", { body: { link: "usb" } })).json().savedNow).toBe(false);
  });

  it("saves a discovered-only instance under the id it already had, and says so", async () => {
    const { req, saved } = await start([], true);
    await req("POST", "/api/discover");
    const r = (await req("PUT", "/api/instances/d-127-0-0-1/setup", { body: { dsd: "older-ess" } })).json();
    expect([r.savedNow, saved()]).toEqual([true, [expect.objectContaining({ id: "d-127-0-0-1", setup: { dsd: "older-ess" } })]]);
  });

  it("refuses an instance it doesn't know", async () => {
    const { req } = await start([]);
    expect((await req("PUT", "/api/instances/nope/setup", { body: { dsd: "direct" } })).status).toBe(404);
  });

  it("refuses an invalid answer without saving anything", async () => {
    const { req, saved } = await start([{ id: "mac", name: "Mac", host: "127.0.0.1", port: 0 }]);
    const r = await req("PUT", "/api/instances/mac/setup", { body: { dsd: "seventh" } });
    expect([r.status, (await req("GET", "/api/instances")).json()[0].setup]).toEqual([400, undefined]);
    expect(() => saved()).toThrow(); // instances.json was never written
  });

  it("keeps a setting it doesn't know when it saves, so an older hqpweb keeps these answers too", async () => {
    // Older versions write back the instance objects as they read them; this is the same code path.
    const { req, saved } = await start([{ id: "mac", name: "Mac", host: "127.0.0.1", port: 0, future: 1 } as never]);
    await req("PATCH", "/api/instances/mac", { body: { name: "Mac 2" } });
    expect(saved()[0]).toMatchObject({ name: "Mac 2", future: 1 });
  });
});
