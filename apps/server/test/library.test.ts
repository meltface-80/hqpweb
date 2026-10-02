import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import { client } from "./http.ts";

let fake: FakeHqp;
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;

async function setup() {
  fake = new FakeHqp(loadProfile("desktop5-linux-pcm"), { timeScale: 0 });
  await fake.listen();
  app = buildApp({ instances: [{ id: "lx", name: "Linux", host: "127.0.0.1", port: fake.port }] });
  req = client(await app.listen(0, "127.0.0.1"));
}
afterEach(async () => {
  await app.close();
  await fake.close();
});

describe("library", () => {
  it("lists albums sorted by artist, without paths or tracks", async () => {
    await setup();
    const r = (await req("GET", "/api/instances/lx/library")).json();
    expect(r.total).toBe(3);
    expect(r.albums.map((a: { artist: string }) => a.artist)).toEqual(["Another Band", "Ensemble Y", "Example Artist"]);
    expect(r.albums[0]).toMatchObject({ hash: "a2", album: "Second Album", trackCount: 1 });
    expect(r.albums[0].path).toBeUndefined();
    expect(r.albums[0].tracks).toBeUndefined();
  });

  it("searches across fields, every word must match", async () => {
    await setup();
    expect((await req("GET", "/api/instances/lx/library?q=quartets")).json().total).toBe(1);
    expect((await req("GET", "/api/instances/lx/library?q=example%20first")).json().total).toBe(1);
    expect((await req("GET", "/api/instances/lx/library?q=nothing")).json().total).toBe(0);
  });

  it("pages", async () => {
    await setup();
    const r = (await req("GET", "/api/instances/lx/library?offset=1&limit=1")).json();
    expect(r).toMatchObject({ total: 3, offset: 1 });
    expect(r.albums).toHaveLength(1);
  });

  it("returns an album with its tracks", async () => {
    await setup();
    const a = (await req("GET", "/api/instances/lx/library/albums/a1")).json();
    expect(a.tracks.map((t: { song: string }) => t.song)).toEqual(["01 - Opening", "02 - Middle", "03 - Closing"]);
    expect((await req("GET", "/api/instances/lx/library/albums/nope")).status).toBe(404);
  });

  it("404s cover art when HQPlayer has none", async () => {
    await setup();
    expect((await req("GET", "/api/instances/lx/library/art/a1")).status).toBe(404);
  });

  it("plays an album from a track by queueing its files", async () => {
    await setup();
    const r = (await req("POST", "/api/instances/lx/library/play", { body: { album: "a1", track: 1 } })).json();
    expect(r.queued).toBe(3);
    expect(fake.playlist).toEqual([
      "/music/Example Artist/First Album/01 - Opening.flac",
      "/music/Example Artist/First Album/02 - Middle.flac",
      "/music/Example Artist/First Album/03 - Closing.flac",
    ]);
    expect(fake.playlistIndex).toBe(1);
    expect(r.status).toMatchObject({ state: 2, source: { song: "02 - Middle.flac" } });
  });

  it("validates play requests", async () => {
    await setup();
    expect((await req("POST", "/api/instances/lx/library/play", { body: {} })).status).toBe(400);
    expect((await req("POST", "/api/instances/lx/library/play", { body: { album: "a1", track: 9 } })).status).toBe(400);
    expect((await req("POST", "/api/instances/lx/library/play", { body: { album: "zz" } })).status).toBe(404);
  });
});

describe("cover art hardening", () => {
  async function withPictures(pictures: Record<string, { type: string; data: Buffer }>) {
    fake = new FakeHqp(loadProfile("desktop5-linux-pcm"), { timeScale: 0, pictures });
    await fake.listen();
    app = buildApp({ instances: [{ id: "lx", name: "Linux", host: "127.0.0.1", port: fake.port }] });
    req = client(await app.listen(0, "127.0.0.1"));
  }

  it("serves real image types as images, with nosniff and a locked-down CSP", async () => {
    await withPictures({ a1: { type: "image/png", data: Buffer.from("PNGDATA") } });
    const r = await req("GET", "/api/instances/lx/library/art/a1");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(r.text()).toBe("PNGDATA");
  });

  it("never serves a tag-supplied type like text/html as a document", async () => {
    await withPictures({ a1: { type: "text/html", data: Buffer.from("<script>alert(1)</script>") } });
    const r = await req("GET", "/api/instances/lx/library/art/a1");
    expect(r.headers["content-type"]).toBe("application/octet-stream");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
});
