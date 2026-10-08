// The meter stream end to end (meter-stream.ts, the fake's meter.ts): connected only while
// someone watches, paced and condensed, and honest when there's no meter.
import { afterEach, describe, expect, it } from "vitest";
import { FakeHqp, FakeMeter, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import type { MeterEvent } from "../src/meter-stream.ts";

let fake: FakeHqp;
let meter: FakeMeter | null;
let app: ReturnType<typeof buildApp>;
let base: string;
afterEach(async () => {
  await app.close();
  await meter?.close();
  await fake.close();
});

async function setup(withMeter = true) {
  fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
  await fake.listen();
  meter = withMeter ? new FakeMeter(fake) : null;
  const meterPort = meter ? await meter.listen() : 1; // port 1: nothing listens
  app = buildApp(
    { instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port, meterPort }] },
    { meterTiming: { lingerMs: 100, retryMs: 100 } },
  );
  base = await app.listen(0, "127.0.0.1");
}

/** Opens the meter stream; collects events until `ok` or the deadline. */
async function watchMeter(ok: (e: MeterEvent) => boolean, ms = 3000) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/instances/mac/meter`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  const t0 = Date.now();
  let text = "";
  let hit: MeterEvent | undefined;
  while (!hit && Date.now() - t0 < ms) {
    const r = await reader.read();
    text += new TextDecoder().decode(r.value);
    for (const m of text.matchAll(/event: meter\ndata: (.*)\n/g)) {
      const e = JSON.parse(m[1]!) as MeterEvent;
      if (ok(e)) hit = e;
    }
    text = text.slice(text.lastIndexOf("\n\n") + 2);
  }
  return { hit, close: () => ctl.abort() };
}

describe("the meter stream", () => {
  it("connects only while watched, and sends 48 bands per channel and the levels", async () => {
    await setup();
    expect(meter!.connections).toBe(0);
    const w = await watchMeter((e) => e.live);
    expect(meter!.connections).toBe(1);
    expect(w.hit!.bands!.map((b) => b.length)).toEqual([48, 48]);
    expect(w.hit!.levels![0]![1]).toBeCloseTo(-22, 0); // peak follows the fake's volume
    w.close();
  });

  it("lets go of HQPlayer's meter port after the last viewer leaves", async () => {
    await setup();
    const w = await watchMeter((e) => e.live);
    w.close();
    const t0 = Date.now();
    while (meter!.connections > 0 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 20)); // polling for a condition, with a deadline
    expect(meter!.connections).toBe(0);
  });

  it("says plainly when there's no meter: not connected, not live", async () => {
    await setup(false);
    const w = await watchMeter(() => true);
    expect(w.hit).toEqual({ live: false, connected: false });
    w.close();
  });
});
