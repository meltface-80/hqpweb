// Switching mode while playing (change-engine.ts, pauseForModeSwitch). Measured 2026-10-08:
// SetMode during playback crashed HQPlayer Desktop (macOS) twice; paused first, it switched.
// The fake crashes the same way (its default). With Roon as the source, Roon's pause and
// play carried on from the same spot; HQPlayer's Play didn't resume Roon.
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import type { RoonTransport } from "../src/change-engine.ts";
import type { WatchTiming } from "../src/watch.ts";
import { client } from "./http.ts";

const FAST: WatchTiming = { graceMs: 100, healthyMs: 300, maxMs: 1200, sampleMs: 40, minSpeed: 0.85 };

let fake: FakeHqp;
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;
afterEach(async () => {
  await app.close();
  await fake.close();
});

/** `roon`: a stand-in for Roon's transport on the linked zone, which drives HQPlayer as Roon does. */
async function setup(roon: "linked" | "none" = "none") {
  fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
  await fake.listen();
  const calls: string[] = [];
  const transport: RoonTransport = {
    pause: async () => {
      calls.push("pause");
      if (fake.playback === 2) fake.playback = 1;
    },
    play: async () => {
      calls.push("play");
      fake.playback = 2;
    },
  };
  app = buildApp(
    { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] },
    {
      pollMs: 50,
      timing: { quick: FAST, major: FAST },
      playWaitMs: 400,
      roonTransport: () => (roon === "linked" ? transport : null),
    },
  );
  req = client(await app.listen(0, "127.0.0.1"));
  return calls;
}
const change = (body: object) => req("POST", "/api/instances/mac/change", { body });
const sentTransport = () => fake.received.map((x) => /<(Pause|SetMode|Play)\b/.exec(x)?.[1]).filter(Boolean);

describe("switching mode while playing", () => {
  // Measured 2026-10-08: SetMode during playback crashed HQPlayer Desktop (macOS) twice;
  // paused first, the switch worked. The fake crashes the same way (its default).
  it("pauses before switching mode while playing, then resumes its own playlist, so HQPlayer survives", async () => {
    await setup();
    fake.feeder = "playlist";
    fake.playlist = ["/music/Example Artist/Example Album/01 - Example.flac"];
    expect(fake.playback).toBe(2);
    const body = (await change({ mode: "PCM" })).json();
    expect(fake.crashed).toBe(false);
    expect(body.results[0]).toMatchObject({ field: "mode", actual: "PCM", applied: true });
    expect(body.playback).toEqual({ kind: "playing" });
    const order = fake.received.map((x) => /<(Pause|SetMode|Play)\b/.exec(x)?.[1]).filter(Boolean);
    expect(order).toEqual(["Pause", "SetMode", "Play"]);
  });

  // Measured 2026-10-08: HQPlayer's Play doesn't resume Roon (it plays ~6 s of buffer, then stops).
  it("with Roon as the source, pauses for the mode switch and leaves resuming to Roon", async () => {
    await setup();
    const body = (await change({ mode: "PCM" })).json();
    expect(fake.crashed).toBe(false);
    expect(fake.mode.name).toBe("PCM");
    expect(body.playback.detail).toMatch(/press play in Roon/);
    expect(body.rolledBack).toBeNull();
    expect(fake.received.some((x) => /<Play\b/.test(x))).toBe(false);
  });

  it("switches mode without pausing or playing when nothing is playing", async () => {
    await setup();
    fake.playback = 0;
    await change({ mode: "PCM" });
    expect(fake.mode.name).toBe("PCM");
    expect(fake.received.some((x) => /<(Pause|Play)\b/.test(x))).toBe(false);
  });

  it("with Roon linked in hqpweb, pauses and resumes through Roon, and playback carries on", async () => {
    const calls = await setup("linked");
    const body = (await change({ mode: "PCM" })).json();
    expect(fake.crashed).toBe(false);
    expect(calls).toEqual(["pause", "play"]);
    expect(sentTransport()).toEqual(["SetMode"]);
    expect(body.playback).toEqual({ kind: "playing" });
  });
});
