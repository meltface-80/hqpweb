// The status stream (server-sent events): live health, the queued track, volume jumps.
// Each test builds its own fake and server.
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import { setTimeout as slowReply } from "node:timers/promises";
import { client } from "./http.ts";

let fake: FakeHqp;
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;
let base: string;
afterEach(async () => {
  await app.close();
  await fake.close();
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

// A slow answer that overlapped hqpweb's own write (here a mode switch, which holds the
// connection ~2.9 s on the real thing) isn't HQPlayer being slow: no backing off then.
describe("polling after hqpweb's own slow write", () => {
  it("keeps the status coming right after a mode switch", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0.5 }); // SetMode ~1.45 s
    fake.playback = 0;
    await fake.listen();
    app = buildApp({ instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] }, { pollMs: 100 });
    base = await app.listen(0, "127.0.0.1");
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/instances/mac/events`, { signal: ctl.signal });
    const reader = res.body!.getReader();
    const seen: { at: number; mode: string }[] = [];
    void (async () => {
      let text = "";
      for (;;) {
        const r = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (r.done) return;
        text += new TextDecoder().decode(r.value);
        for (const m of text.matchAll(/event: now\ndata: (.*)\n/g))
          seen.push({ at: Date.now(), mode: JSON.parse(m[1]!).status.activeMode });
        text = text.slice(text.lastIndexOf("\n\n") + 2);
      }
    })();
    await client(base)("POST", "/api/instances/mac/change", { body: { mode: "PCM" } });
    const done = Date.now();
    const t0 = Date.now();
    while (!seen.some((s) => s.at > done && s.mode === "PCM") && Date.now() - t0 < 4000) {
      await new Promise((r) => setTimeout(r, 20)); // polling for a condition, with a deadline
    }
    ctl.abort();
    const next = seen.find((s) => s.at > done && s.mode === "PCM");
    expect(next && next.at - done).toBeLessThan(1500);
  });
});

describe("polling when HQPlayer itself is slow", () => {
  it("backs off when a slow reply wasn't waiting on hqpweb's own write", async () => {
    const { StatusPoller } = await import("../src/poller.ts");
    const real = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
    await real.listen();
    const { HqpClient } = await import("@app/protocol");
    const c = new HqpClient("127.0.0.1", { port: real.port });
    // HQPlayer answering slowly (~1.1 s), with no write of hqpweb's in flight.
    const slow = Object.assign(Object.create(c) as typeof c, {
      status: () => slowReply(1100).then(() => c.status()),
    });
    const p = new StatusPoller(slow, {
      speedWindowMs: 30_000,
      queueEveryMs: 5000,
      ownWrites: () => ({ count: 0, active: false }),
    });
    const at: number[] = [];
    const stop = p.subscribe(() => at.push(Date.now()), 100);
    const t0 = Date.now();
    while (at.length < 2 && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50)); // polling for a condition, with a deadline
    stop();
    p.close();
    c.close();
    await real.close();
    // Backed off to ~3× the 1.1 s reply, not the 100 ms interval.
    expect(at[1]! - at[0]!).toBeGreaterThan(3000);
  }, 15_000);
});
