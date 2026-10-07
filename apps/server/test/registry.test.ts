import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { discover } from "@app/protocol";
import { buildApp } from "../src/app.ts";
import { client } from "./http.ts";

const fakes: FakeHqp[] = [];
let app: ReturnType<typeof buildApp> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(fakes.splice(0).map((f) => f.close()));
});

async function fake(profile = "desktop5-mac-sdm") {
  const f = new FakeHqp(loadProfile(profile), { timeScale: 0 });
  fakes.push(f);
  await f.listen();
  const discoveryPort = await f.listenDiscovery(0);
  return { f, discoveryPort };
}

describe("discover()", () => {
  it("parses the measured reply shape", async () => {
    const { discoveryPort } = await fake();
    const found = await discover({ target: { address: "127.0.0.1", port: discoveryPort }, timeoutMs: 300 });
    expect(found).toEqual([{ address: "127.0.0.1", name: "fake-mac", version: "Signalyst HQPlayer Desktop 5" }]);
  });

  it("still finds an instance when the first probes are lost", async () => {
    const { f, discoveryPort } = await fake();
    f.dropProbes = 2;
    const found = await discover({ target: { address: "127.0.0.1", port: discoveryPort }, timeoutMs: 600 });
    expect(found).toHaveLength(1);
  });

  it("finds nothing while every probe is lost (the fake really drops them)", async () => {
    const { f, discoveryPort } = await fake();
    f.dropProbes = 1000;
    expect(await discover({ target: { address: "127.0.0.1", port: discoveryPort }, timeoutMs: 300 })).toEqual([]);
  });

  it("returns nothing when nobody answers", async () => {
    expect(await discover({ target: { address: "127.0.0.1", port: 9 }, timeoutMs: 200 })).toEqual([]);
  });
});

describe("registry", () => {
  it("dedupes a discovered instance against a configured one with the same address", async () => {
    const { f, discoveryPort } = await fake();
    app = buildApp(
      { instances: [{ id: "mac", name: "My Mac", host: "127.0.0.1", port: f.port }] },
      { discovery: { target: { address: "127.0.0.1", port: discoveryPort }, timeoutMs: 200 } },
    );
    const req = client(await app.listen(0, "127.0.0.1"));
    const list = (await req("POST", "/api/discover")).json();
    expect(list).toEqual([expect.objectContaining({ id: "mac", name: "My Mac", discovered: true, reachable: true })]);
  });

  it("dedupes by HQPlayer name when the addresses differ (e.g. 127.0.0.1 vs LAN IP)", async () => {
    const { f, discoveryPort } = await fake();
    // Configured by hostname "localhost"; discovery replies from 127.0.0.1. The
    // HQPlayer name (GetInfo vs discovery) is what ties them together.
    app = buildApp(
      { instances: [{ id: "mac", name: "My Mac", host: "localhost", port: f.port }] },
      { discovery: { target: { address: "127.0.0.1", port: discoveryPort }, timeoutMs: 200 } },
    );
    const req = client(await app.listen(0, "127.0.0.1"));
    await req("GET", "/api/instances"); // health check learns the HQPlayer name
    const list = (await req("POST", "/api/discover")).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "mac", discovered: true });
  });

  it("lists a discovered-only instance and makes it usable", async () => {
    const { f, discoveryPort } = await fake();
    // Never let a test reach 4321: on a dev machine that may be a real HQPlayer.
    app = buildApp(
      { instances: [] },
      { discovery: { target: { address: "127.0.0.1", port: discoveryPort }, timeoutMs: 200 }, discoveredPort: f.port },
    );
    const req = client(await app.listen(0, "127.0.0.1"));
    const list = (await req("POST", "/api/discover")).json();
    expect(list).toEqual([
      expect.objectContaining({ id: "d-127-0-0-1", name: "fake-mac", source: "discovered", reachable: true }),
    ]);
    expect((await req("GET", "/api/instances/d-127-0-0-1/now")).json().info.name).toBe("fake-mac");
  });

  it("adds and removes instances, persisting to instances.json", async () => {
    const { f } = await fake();
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    app = buildApp({ instances: [] }, { configDir: dir });
    const req = client(await app.listen(0, "127.0.0.1"));
    const added = (await req("POST", "/api/instances", { body: { name: "Office HQP", host: "127.0.0.1", port: f.port } })).json();
    expect(added).toMatchObject({ id: "office-hqp", host: "127.0.0.1", port: f.port });
    expect(JSON.parse(readFileSync(join(dir, "instances.json"), "utf8")).instances).toHaveLength(1);
    expect((await req("GET", "/api/instances/office-hqp/now")).status).toBe(200);

    expect((await req("POST", "/api/instances", { body: { name: "Dup", host: "127.0.0.1", port: f.port } })).status).toBe(409);
    expect((await req("POST", "/api/instances", { body: { name: "Bad", host: "a b" } })).status).toBe(400);
    expect((await req("POST", "/api/instances", { body: { name: "X", host: "h", extra: 1 } })).status).toBe(400);

    // Rename keeps the id; a blank name is refused.
    expect((await req("PATCH", "/api/instances/office-hqp", { body: { name: "  " } })).status).toBe(400);
    expect((await req("PATCH", "/api/instances/office-hqp", { body: { name: "Den" } })).json()).toMatchObject({
      id: "office-hqp",
      name: "Den",
    });
    expect(JSON.parse(readFileSync(join(dir, "instances.json"), "utf8")).instances[0].name).toBe("Den");
    expect((await req("PATCH", "/api/instances/nope", { body: { name: "X" } })).status).toBe(404);

    expect((await req("DELETE", "/api/instances/office-hqp")).status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "instances.json"), "utf8")).instances).toHaveLength(0);

    // A blank name becomes HQPlayer's own name, or the host when it doesn't answer.
    const hqpName = await (async () => {
      await req("POST", "/api/instances", { body: { name: "Tmp", host: "127.0.0.1", port: f.port } });
      const n = (await req("GET", "/api/instances/tmp/now")).json().info.name as string;
      await req("DELETE", "/api/instances/tmp");
      return n;
    })();
    expect(hqpName).toBeTruthy();
    expect((await req("POST", "/api/instances", { body: { name: "", host: "127.0.0.1", port: f.port } })).json().name).toBe(
      hqpName,
    );
    expect((await req("POST", "/api/instances", { body: { name: "", host: "127.0.0.1", port: 1 } })).json().name).toBe(
      "127.0.0.1",
    );
    expect((await req("DELETE", "/api/instances/office-hqp")).status).toBe(404);
  });

  it("flags an unreachable configured instance quickly", async () => {
    app = buildApp({ instances: [{ id: "gone", name: "Gone", host: "127.0.0.1", port: 1 }] });
    const req = client(await app.listen(0, "127.0.0.1"));
    const t = Date.now();
    expect((await req("GET", "/api/instances")).json()[0]).toMatchObject({ reachable: false });
    expect(Date.now() - t).toBeLessThan(3000);
  });
});
