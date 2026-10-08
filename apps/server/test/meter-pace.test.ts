// HQPlayer sends meter frames in bursts (~12 at a time, ~4 times a second: measured
// 2026-10-08). Shown as they come, the meter jerks 4 times a second; paced, it moves smoothly
// at the cost of ~0.3 s of delay.
import { describe, expect, it } from "vitest";
import { MeterPacer } from "../src/meter-pace.ts";

/** Feed 12 frames every 250 ms for `ms`, ticking every 50 ms; returns the frame shown at each tick. */
function run(ms: number) {
  const p = new MeterPacer<number>();
  const shown: (number | null)[] = [];
  let next = 0;
  for (let t = 0; t < ms; t += 50) {
    if (t % 250 === 0) for (let i = 0; i < 12; i++) p.push(next++, t);
    shown.push(p.take(t));
  }
  return shown;
}

describe("pacing burst frames", () => {
  it("shows a new frame at nearly every tick, not one per burst", () => {
    const shown = run(3000).slice(10); // after the first ~0.5 s
    const changes = shown.filter((v, i) => i > 0 && v !== shown[i - 1]).length;
    expect(changes).toBeGreaterThan(shown.length * 0.8);
  });

  it("keeps the delay bounded: never more than ~30 frames behind", () => {
    const p = new MeterPacer<number>();
    for (let i = 0; i < 200; i++) p.push(i, 0);
    expect(p.take(0)! >= 200 - 31).toBe(true);
  });

  it("says when frames stopped coming (track change, stop): nothing new after 3 s", () => {
    const p = new MeterPacer<number>();
    p.push(1, 0);
    expect(p.live(1000)).toBe(true);
    expect(p.live(3500)).toBe(false);
  });
});
