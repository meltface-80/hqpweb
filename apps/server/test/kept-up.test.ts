// "Kept up here": how fast HQPlayer processed a combination on this machine, once settled.
// HQPlayer is often slow for the first seconds after a start or a change and then
// settles (seen by the owner), so the measure skips a warm-up and averages windows.
import { describe, expect, it } from "vitest";
import { KeptUpTracker, type KeptTiming } from "../src/kept-up.ts";

const T: KeptTiming = { warmupMs: 15_000, windowMs: 5000, minWindows: 6, maxGapMs: 5000 };

/** Feed one sample a second for `secs`, speed from `f(second)`; returns what was emitted. */
function run(tr: KeptUpTracker, from: number, secs: number, f: (s: number) => number, key = "A") {
  const out = [];
  for (let s = 0; s < secs; s++) {
    const r = tr.feed({ t: (from + s) * 1000, key, speed: f(s) });
    if (r) out.push(r);
  }
  return out;
}

describe("kept-up tracker", () => {
  it("ignores a bad start: terrible for the first seconds, then steady", () => {
    const tr = new KeptUpTracker(T);
    const out = run(tr, 0, 60, (s) => (s < 10 ? 0.4 : 2.1));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "A", low: 2.1, typical: 2.1 });
  });

  it("still reports a combination that is slow once settled, as its lowest 5-second average", () => {
    const tr = new KeptUpTracker(T);
    // Settled at 1.3, with one slow stretch (0.9) well after the warm-up.
    const out = run(tr, 0, 60, (s) => (s >= 30 && s < 35 ? 0.9 : 1.3));
    expect(out[0]!.low).toBeCloseTo(0.9, 2);
    expect(out[0]!.typical).toBeCloseTo(1.3, 2);
  });

  it("records nothing for a session too short to settle", () => {
    const tr = new KeptUpTracker(T);
    expect(run(tr, 0, 40, () => 2)).toEqual([]); // 15 s warm-up + 25 s = 5 windows < 6
    expect(tr.end()).toBeNull();
  });

  it("starts over when the combination changes, and ends the old one with its result", () => {
    const tr = new KeptUpTracker(T);
    run(tr, 0, 50, () => 2); // A: settled (7 windows)
    const ended = tr.feed({ t: 50_000, key: "B", speed: 3 });
    expect(ended).toMatchObject({ key: "A", typical: 2, final: true });
    const b = run(tr, 51, 60, () => 3, "B");
    expect(b[0]).toMatchObject({ key: "B", typical: 3 });
  });

  it("ends the session when playback stops or samples stop coming", () => {
    const tr = new KeptUpTracker(T);
    run(tr, 0, 50, () => 2);
    expect(tr.feed({ t: 50_000, key: null, speed: null })).toMatchObject({ key: "A", final: true });
    // A gap (nobody watching) also ends it, with nothing carried over.
    run(tr, 100, 50, () => 2);
    expect(tr.feed({ t: 200_000, key: "A", speed: 2 })).toMatchObject({ key: "A", final: true });
  });
});
