import { describe, expect, it } from "vitest";
import { judge, type Sample, type WatchTiming } from "../src/watch.ts";

const T: WatchTiming = { graceMs: 1000, healthyMs: 1000, maxMs: 4000, sampleMs: 250, minSpeed: 0.85 };

/** Samples every 250 ms from t=0 to `until`, with a position function. */
const run = (until: number, state: (t: number) => number, pos: (t: number) => number): Sample[] => {
  const out: Sample[] = [];
  for (let t = 0; t <= until; t += 250) out.push({ t, state: state(t), position: pos(t) });
  return out;
};

describe("judge", () => {
  it("passes steady playback after the grace period", () => {
    expect(judge(run(2000, () => 2, (t) => 100 + t / 1000), T, false)).toEqual({ kind: "playing" });
  });

  it("ignores a brief pause inside the grace period", () => {
    const pos = (t: number) => (t < 800 ? 100 : 100 + (t - 800) / 1000);
    expect(judge(run(2250, () => 2, pos), T, false)).toEqual({ kind: "playing" });
  });

  it("waits for more evidence before the healthy window is complete", () => {
    expect(judge(run(1250, () => 2, (t) => t / 1000), T, false)).toEqual({ kind: "pending" });
  });

  it("fails fast on the measured stall: state 3 then 0", () => {
    const v = judge(run(2250, (t) => (t < 500 ? 2 : t < 1000 ? 3 : 0), () => 50), T, false);
    expect(v.kind).toBe("stopped");
  });

  it("calls slow progress struggling, at the end of the window", () => {
    const samples = run(4000, () => 2, (t) => 100 + (t / 1000) * 0.5);
    expect(judge(samples.slice(0, 9), T, false)).toEqual({ kind: "pending" });
    expect(judge(samples, T, true)).toMatchObject({ kind: "struggling", detail: "playing at 50% of real time" });
  });

  it("calls it early once slow progress lasts twice the healthy window", () => {
    // grace 1000 + 2 × 1000 → judged at 3000 ms, before maxMs (4000)
    const samples = run(3000, () => 2, (t) => 100 + (t / 1000) * 0.5);
    expect(judge(samples, T, false).kind).toBe("struggling");
  });

  it("treats a frozen position with state 2 as stopped", () => {
    expect(judge(run(4000, () => 2, () => 42), T, true).kind).toBe("stopped");
  });

  it("survives a track change (position jumps back)", () => {
    const pos = (t: number) => (t < 1500 ? 200 + t / 1000 : (t - 1500) / 1000);
    expect(judge(run(3000, () => 2, pos), T, false)).toEqual({ kind: "playing" });
  });

  it("is inconclusive if someone pauses", () => {
    expect(judge(run(2000, (t) => (t > 1200 ? 1 : 2), (t) => t / 1000), T, false).kind).toBe("inconclusive");
  });
});
