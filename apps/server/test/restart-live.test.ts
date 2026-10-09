// Restart recovery end to end, against the fake (restart-guard.ts, wired in instance.ts):
// with a cap set, hqpweb watches even with no page open; when HQPlayer stops answering and
// comes back at a different, louder volume, hqpweb lowers it to the cap and logs it. A blip
// that leaves the volume alone is left alone. Nothing is ever raised.
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { HqpClient, cmd } from "@app/protocol";
import { buildApp } from "../src/app.ts";
import type { HistoryEntry } from "../src/history.ts";
import { client } from "./http.ts";

let fake: FakeHqp;
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;
afterEach(async () => {
  await app.close();
  await fake.close();
});

async function setup(volume: number, cap?: number) {
  fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
  await fake.listen();
  fake.volume = volume;
  app = buildApp(
    {
      instances: [
        { id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port, ...(cap !== undefined ? { restartVolumeCap: cap } : {}) },
      ],
    },
    {},
  );
  req = client(await app.listen(0, "127.0.0.1"));
}
async function until(ok: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!ok() && Date.now() - t0 < ms) await sleep(50); // polling for a condition, with a deadline
  return ok();
}
/** HQPlayer goes away for a few polls, then comes back on the same port at `volume`. */
async function restartAt(volume: number) {
  const port = fake.port;
  await fake.close();
  await sleep(2500); // long enough for a failed poll or two
  fake.volume = volume;
  await fake.listen(port);
}

describe("after HQPlayer restarts", () => {
  it("lowers it to the cap, with no page open, and logs it", async () => {
    await setup(-40, -30);
    expect(await until(() => fake.received.some((r) => r.includes("<Status")))).toBe(true); // watching, unviewed
    await restartAt(-15);
    expect(await until(() => fake.volume === -30)).toBe(true);
    const h: HistoryEntry[] = (await req("GET", "/api/instances/mac/history")).json();
    expect(h[0]).toMatchObject({ source: "hqpweb", changes: [{ field: "volume", from: -15, to: -30, applied: true }] });
    expect(h[0]!.detail).toMatch(/restarted/);
  }, 20_000);

  it("doesn't log HQPlayer's start-up states as changes made elsewhere", async () => {
    await setup(-40, -30);
    expect(await until(() => fake.received.some((r) => r.includes("<Status")))).toBe(true);
    fake.playback = 0; // the fake, like the Mac's HQPlayer, crashes on a mode switch while playing
    await sleep(1500); // a settled baseline first
    await restartAt(-15);
    // Starting up, HQPlayer passes through other states (seen: the mode flipping); here, a
    // mode switch and back, made straight after it answers again.
    const hqp = new HqpClient("127.0.0.1", { port: fake.port });
    await hqp.send(cmd.setMode(1));
    await sleep(1200);
    await hqp.send(cmd.setMode(2));
    hqp.close();
    expect(await until(() => fake.volume === -30)).toBe(true);
    await sleep(1500);
    const h: HistoryEntry[] = (await req("GET", "/api/instances/mac/history")).json();
    expect(h.filter((e) => e.source === "elsewhere")).toEqual([]);
  }, 25_000);

  it("leaves a blip alone: same volume back, even above the cap", async () => {
    await setup(-20, -30);
    expect(await until(() => fake.received.some((r) => r.includes("<Status")))).toBe(true);
    await restartAt(-20);
    await until(() => false, 2500); // give it time to (wrongly) act
    expect(fake.volume).toBe(-20);
  }, 20_000);

  it("does nothing without a cap, and doesn't watch", async () => {
    await setup(-40);
    await sleep(1500);
    expect(fake.received.some((r) => r.includes("<Status"))).toBe(false);
  }, 10_000);
});

describe("the cap setting", () => {
  it("is set and cleared per instance, and refuses nonsense", async () => {
    await setup(-40);
    const set = await req("PUT", "/api/instances/mac/restartcap", { body: { maxDb: -30.2 } });
    expect(set.json().restartVolumeCap).toBe(-30); // half-dB steps
    expect((await req("GET", "/api/instances")).json()[0].restartVolumeCap).toBe(-30);
    expect(await until(() => fake.received.some((r) => r.includes("<Status")))).toBe(true); // now watching
    expect((await req("PUT", "/api/instances/mac/restartcap", { body: { maxDb: 6 } })).status).toBe(400);
    expect((await req("PUT", "/api/instances/mac/restartcap", { body: { maxDb: "-30" } })).status).toBe(400);
    const off = await req("PUT", "/api/instances/mac/restartcap", { body: { maxDb: null } });
    expect(off.json().restartVolumeCap).toBeUndefined();
  }, 15_000);
});
