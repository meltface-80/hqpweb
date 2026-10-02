import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHqp, FakeRoon, loadProfile } from "@app/fake-hqp";
import { decode, encode } from "../src/roon/moo.ts";
import { decodePacket, encodeQuery } from "../src/roon/sood.ts";
import { RoonLink, type RoonView } from "../src/roon/roon.ts";
import { buildApp } from "../src/app.ts";
import { client } from "./http.ts";

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

async function core() {
  const c = new FakeRoon();
  const port = await c.listen();
  cleanup.push(() => c.close());
  return { c, port };
}
function link(path: string | null = null) {
  const l = new RoonLink(path, { reconnectMs: 50, replyMs: 1000 });
  cleanup.push(() => l.close());
  return l;
}

describe("MOO framing", () => {
  it("round-trips a request with a JSON body", () => {
    const m = decode(encode("REQUEST", "com.roonlabs.transport:2/control", 7, { control: "next" }));
    expect(m).toMatchObject({ verb: "REQUEST", service: "com.roonlabs.transport:2", name: "control", requestId: "7", body: { control: "next" } });
  });
  it("round-trips a reply without a body", () => {
    const m = decode(encode("COMPLETE", "Success", 3));
    expect(m).toMatchObject({ verb: "COMPLETE", name: "Success", requestId: "3" });
    expect(m.body).toBeUndefined();
  });
  it("rejects malformed messages", () => {
    expect(() => decode("")).toThrow();
    expect(() => decode("HTTP/1.1 200 OK\n\n")).toThrow(/first line/);
    expect(() => decode("MOO/1 COMPLETE Success\n\n")).toThrow(/Request-Id/);
    expect(() => decode("MOO/1 COMPLETE Success\nRequest-Id: 1\nContent-Length: 2\n\n{}")).toThrow(/together/);
    expect(() => decode("MOO/1 COMPLETE Success\nRequest-Id: 1\nContent-Length: 99\nContent-Type: application/json\n\n{}")).toThrow(/Length/);
  });
});

describe("SOOD", () => {
  it("encodes a query the decoder reads back", () => {
    const p = decodePacket(encodeQuery({ query_service_id: "abc", _tid: "t1" }));
    expect(p).toEqual({ type: "Q", props: { query_service_id: "abc", _tid: "t1" } });
  });
  it("ignores packets that aren't SOOD v2", () => {
    expect(decodePacket(Buffer.from("HELLO"))).toBeNull();
    expect(decodePacket(Buffer.from("SOOD\x01Q"))).toBeNull();
  });
});

describe("Roon link", () => {
  it("is off by default and never connects", () => {
    const l = link();
    expect(l.view()).toMatchObject({ enabled: false, status: "off", zones: [] });
  });

  it("waits for approval, then connects and remembers the token", async () => {
    const { c, port } = await core();
    const dir = mkdtempSync(join(tmpdir(), "roon-"));
    const l = link(join(dir, "roon.json"));
    l.configure({ enabled: true, host: "127.0.0.1", port });
    await until(() => l.view().status === "unapproved");
    expect(c.waiting()).toEqual([l.view().extensionName]);
    c.approve();
    await until(() => l.view().status === "connected" && l.view().zones.length === 2);
    const saved = JSON.parse(readFileSync(join(dir, "roon.json"), "utf8"));
    expect(Object.keys(saved.tokens)).toEqual([c.coreId]);

    // A restart reuses the token: no second approval.
    l.close();
    c.approved.clear();
    const again = link(join(dir, "roon.json"));
    await until(() => again.view().status === "connected");
    expect(again.view().extensionName).toBe(l.view().extensionName);
  });

  it("lists HQPlayer zones first and maps one to an instance", async () => {
    const { c, port } = await core();
    const l = link();
    l.configure({ enabled: true, host: "127.0.0.1", port });
    await until(() => l.view().status === "unapproved");
    c.approve();
    await until(() => l.view().zones.length === 2);
    expect(l.view().zones.map((z) => [z.name, z.hqplayer])).toEqual([
      ["Listening Room", true],
      ["Kitchen", false],
    ]);
    expect(l.zoneFor("hqp1")).toBeNull();
    l.setZone("hqp1", "zone-hqp");
    expect(l.zoneFor("hqp1")).toMatchObject({
      name: "Listening Room",
      state: "playing",
      nowPlaying: { track: "Example Track", artist: "Example Artist", album: "Example Album", imageKey: "img1" },
      allowed: { pause: true, play: false },
    });
  });

  it("controls the mapped zone and follows changes", async () => {
    const { c, port } = await core();
    const l = link();
    l.configure({ enabled: true, host: "127.0.0.1", port });
    await until(() => l.view().status === "unapproved");
    c.approve();
    await until(() => l.view().zones.length === 2);
    l.setZone("hqp1", "zone-hqp");
    await l.control("hqp1", "pause");
    await until(() => l.zoneFor("hqp1")?.state === "paused");
    c.update("zone-hqp", { state: "playing" });
    await until(() => l.zoneFor("hqp1")?.state === "playing");
    await expect(l.control("nobody", "next")).rejects.toThrow(/no Roon zone/);
  });

  it("answers the core's pings", async () => {
    const { c, port } = await core();
    const l = link();
    l.configure({ enabled: true, host: "127.0.0.1", port });
    await until(() => l.view().status === "unapproved");
    c.approve();
    await until(() => l.view().status === "connected");
    c.ping();
    await until(() => c.pingReplies() === 1);
  });

  it("reports being taken over by another connection with the same approval", async () => {
    const { c, port } = await core();
    const dir = mkdtempSync(join(tmpdir(), "roon-"));
    const a = link(join(dir, "roon.json"));
    a.configure({ enabled: true, host: "127.0.0.1", port });
    await until(() => a.view().status === "unapproved");
    c.approve();
    await until(() => a.view().status === "connected");
    const b = link(join(dir, "roon.json")); // same config dir = same install id
    await until(() => b.view().status === "connected");
    await until(() => a.view().status === "unreachable");
    expect(a.view().error).toMatch(/took over/);
  });

  it("gives separate installs separate extension ids", async () => {
    const { c, port } = await core();
    const a = link();
    const b = link();
    a.configure({ enabled: true, host: "127.0.0.1", port });
    b.configure({ enabled: true, host: "127.0.0.1", port });
    await until(() => c.waiting().length === 2);
    c.approve();
    await until(() => a.view().status === "connected" && b.view().status === "connected");
    await new Promise((r) => setTimeout(r, 100));
    expect([a.view().status, b.view().status]).toEqual(["connected", "connected"]);
  });

  it("reconnects when the core comes back", async () => {
    const c = new FakeRoon();
    const port = await c.listen();
    const l = link();
    l.configure({ enabled: true, host: "127.0.0.1", port });
    await until(() => l.view().status === "unapproved");
    c.approve();
    await until(() => l.view().status === "connected");
    const approved = new Set(c.approved);
    const tokens = new Map(c.tokens);
    await c.close();
    await until(() => l.view().status === "unreachable");
    const c2 = new FakeRoon();
    c2.approved = approved;
    c2.tokens = tokens;
    await c2.listen(port);
    cleanup.push(() => c2.close());
    await until(() => l.view().status === "connected", 5000);
  });

  it("refuses host values that could reshape a URL", () => {
    const l = link();
    for (const host of ["a/b", "x@y", "h:1", "", "-a"]) expect(() => l.configure({ host })).toThrow(/host/);
  });
});

describe("Roon API routes", () => {
  it("off: no roon events, and transport says to set up a zone", async () => {
    const fake = new FakeHqp(loadProfile("desktop5-linux-pcm"), { timeScale: 0 });
    await fake.listen();
    const app = buildApp({ instances: [{ id: "hq", name: "HQ", host: "127.0.0.1", port: fake.port }] });
    const req = client(await app.listen(0, "127.0.0.1"));
    cleanup.push(() => fake.close(), () => app.close());
    expect((await req("GET", "/api/roon")).json()).toMatchObject({ enabled: false, status: "off" });
    const r = await req("POST", "/api/instances/hq/roontransport", { body: { action: "next" } });
    expect(r.status).toBe(409);
  });

  it("on: configure, map a zone, control it, fetch art", async () => {
    const { c, port } = await core();
    const fake = new FakeHqp(loadProfile("desktop5-linux-pcm"), { timeScale: 0 });
    await fake.listen();
    const roon = link();
    const app = buildApp({ instances: [{ id: "hq", name: "HQ", host: "127.0.0.1", port: fake.port }] }, { roon });
    const req = client(await app.listen(0, "127.0.0.1"));
    cleanup.push(() => fake.close(), () => app.close());

    expect((await req("PUT", "/api/roon", { body: { enabled: true, host: "127.0.0.1", port, extra: 1 } })).status).toBe(400);
    const v = (await req("PUT", "/api/roon", { body: { enabled: true, host: "127.0.0.1", port } })).json() as RoonView;
    expect(v.enabled).toBe(true);
    await until(() => roon.view().status === "unapproved");
    c.approve();
    await until(() => roon.view().zones.length === 2);

    expect((await req("PUT", "/api/instances/hq/roonzone", { body: { zone: 5 } })).status).toBe(400);
    expect((await req("PUT", "/api/instances/hq/roonzone", { body: { zone: "zone-hqp" } })).json().zoneFor).toEqual({ hq: "zone-hqp" });
    expect((await req("POST", "/api/instances/hq/roontransport", { body: { action: "stop" } })).status).toBe(400);
    const r = await req("POST", "/api/instances/hq/roontransport", { body: { action: "pause" } });
    expect(r.status).toBe(200);
    await until(() => roon.zoneFor("hq")?.state === "paused");

    const art = await req("GET", "/api/roon/art/img1?size=100");
    expect(art.status).toBe(200);
    expect(art.headers["content-type"]).toBe("image/png");
    expect(art.headers["content-security-policy"]).toBe("default-src 'none'");
    expect((await req("GET", "/api/roon/art/bad.key")).status).toBe(404);

    // Writes from another site are refused, as for every other write.
    const x = await req("PUT", "/api/roon", { body: { enabled: false }, headers: { origin: "http://evil.example" } });
    expect(x.status).toBe(403);
  });
});
