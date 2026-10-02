import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import { client } from "./http.ts";

const fake = new FakeHqp(loadProfile("desktop5-linux-pcm"), { timeScale: 0 });
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;

beforeAll(async () => {
  await fake.listen();
  app = buildApp(
    {
      instances: [
        { id: "fake", name: "Fake", host: "127.0.0.1", port: fake.port },
        { id: "gone", name: "Gone", host: "127.0.0.1", port: 1 },
      ],
    },
    { allowedHosts: ["controller.example"] },
  );
  req = client(await app.listen(0, "127.0.0.1"));
});
afterAll(async () => {
  await app.close();
  await fake.close();
});

describe("api", () => {
  it("lists instances with reachability", async () => {
    const list = (await req("GET", "/api/instances")).json();
    expect(list).toEqual([
      expect.objectContaining({ id: "fake", name: "Fake", source: "configured", reachable: true, engine: "5.35.10" }),
      expect.objectContaining({ id: "gone", name: "Gone", source: "configured", reachable: false }),
    ]);
  });

  it("returns info, state and status", async () => {
    const r = await req("GET", "/api/instances/fake/now");
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ info: { engine: "5.35.10" }, state: { volume: -28 }, status: { activeMode: "PCM" } });
  });

  it("maps an unreachable instance to 502 and unknown paths to 404", async () => {
    expect((await req("GET", "/api/instances/gone/now")).status).toBe(502);
    expect((await req("GET", "/api/instances/nope/now")).status).toBe(404);
    expect((await req("GET", "/api/instances/fake/bogus")).status).toBe(404);
    expect((await req("DELETE", "/api/instances/fake/now")).status).toBe(404);
  });
});

describe("request hardening", () => {
  it("refuses unknown Host headers (DNS rebinding)", async () => {
    const r = await req("GET", "/api/instances", { headers: { host: "evil.example" } });
    expect(r.status).toBe(403);
  });

  it("accepts configured hosts, with or without a port", async () => {
    expect((await req("GET", "/api/health", { headers: { host: "controller.example" } })).status).toBe(200);
    expect((await req("GET", "/api/health", { headers: { host: "Controller.example:443" } })).status).toBe(200);
  });

  it("refuses cross-origin writes", async () => {
    const r = await req("POST", "/api/instances/fake/change", {
      body: { invert: true },
      headers: { origin: "https://evil.example" },
    });
    expect(r.status).toBe(403);
    expect(fake.invert).toBe(false);
  });

  it("allows same-origin writes", async () => {
    const r = await req("POST", "/api/instances/fake/change", {
      body: { invert: false },
      headers: { origin: "https://controller.example" },
    });
    expect(r.status).toBe(200);
  });

  it("requires a JSON content type (no simple-form CSRF)", async () => {
    const r = await req("POST", "/api/instances/fake/change", {
      rawBody: '{"invert":true}',
      headers: { "content-type": "text/plain" },
    });
    expect(r.status).toBe(415);
  });

  it("caps body size", async () => {
    const r = await req("POST", "/api/instances/fake/change", { body: { filterNx: "x".repeat(20_000) } });
    expect(r.status).toBe(413);
  });
});

describe("static web app", () => {
  it("serves index, hashed assets, SPA fallback, and refuses traversal", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "web-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><p>app</p>");
    writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
    const s = buildApp({ instances: [] }, { staticDir: dir });
    const r = client(await s.listen(0, "127.0.0.1"));
    try {
      const index = await r("GET", "/");
      expect(index.status).toBe(200);
      expect(index.headers["cache-control"]).toBe("no-cache");
      const asset = await r("GET", "/assets/app-abc123.js");
      expect(asset.headers["content-type"]).toMatch(/javascript/);
      expect(asset.headers["cache-control"]).toMatch(/immutable/);
      expect((await r("GET", "/settings")).status).toBe(200); // client-side route
      expect((await r("GET", "/missing.js")).status).toBe(404);
      // Dot segments are collapsed by URL parsing, so these resolve inside the web
      // root and fall back to the app. What matters: never a file outside it.
      for (const p of ["/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc%2fpasswd"]) {
        const res = await r("GET", p);
        expect(res.text()).not.toMatch(/root:/);
        expect([200, 404]).toContain(res.status);
      }
      expect((await r("GET", "/api/nope")).status).toBe(404);
      expect((await r("GET", "/", { headers: { host: "evil.example" } })).status).toBe(403);
    } finally {
      await s.close();
    }
  });
});
