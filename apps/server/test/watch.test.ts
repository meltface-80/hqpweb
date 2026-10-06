import { describe, expect, it } from "vitest";
import { DEFAULT_TIMING, MAJOR_TIMING, judge, type Sample, type WatchTiming } from "../src/watch.ts";

const T: WatchTiming = { graceMs: 1000, healthyMs: 1000, maxMs: 4000, sampleMs: 250, minSpeed: 0.85 };

/** Samples every 250 ms from t=0 to `until`, with a position function. */
const run = (until: number, state: (t: number) => number, pos: (t: number) => number): Sample[] => {
  const out: Sample[] = [];
  for (let t = 0; t <= until; t += 250) out.push({ t, state: state(t), position: pos(t) });
  return out;
};

describe("judge", () => {
  it("passes steady playback after the grace period", () => {
    expect(
      judge(
        run(
          2000,
          () => 2,
          (t) => 100 + t / 1000,
        ),
        T,
        false,
      ),
    ).toEqual({ kind: "playing" });
  });

  it("ignores a brief pause inside the grace period", () => {
    const pos = (t: number) => (t < 800 ? 100 : 100 + (t - 800) / 1000);
    expect(
      judge(
        run(2250, () => 2, pos),
        T,
        false,
      ),
    ).toEqual({ kind: "playing" });
  });

  it("waits for more evidence before the healthy window is complete", () => {
    expect(
      judge(
        run(
          1250,
          () => 2,
          (t) => t / 1000,
        ),
        T,
        false,
      ),
    ).toEqual({ kind: "pending" });
  });

  it("fails fast on the measured stall: state 3 then 0", () => {
    const v = judge(
      run(
        2250,
        (t) => (t < 500 ? 2 : t < 1000 ? 3 : 0),
        () => 50,
      ),
      T,
      false,
    );
    expect(v.kind).toBe("stopped");
  });

  it("calls slow progress struggling, at the end of the window", () => {
    const samples = run(
      4000,
      () => 2,
      (t) => 100 + (t / 1000) * 0.5,
    );
    expect(judge(samples.slice(0, 9), T, false)).toEqual({ kind: "pending" });
    expect(judge(samples, T, true)).toMatchObject({ kind: "struggling", detail: "playing at 50% of real time" });
  });

  it("calls it early once slow progress lasts twice the healthy window", () => {
    // grace 1000 + 2 × 1000 → judged at 3000 ms, before maxMs (4000)
    const samples = run(
      3000,
      () => 2,
      (t) => 100 + (t / 1000) * 0.5,
    );
    expect(judge(samples, T, false).kind).toBe("struggling");
  });

  it("treats a frozen position with state 2 as stopped", () => {
    expect(
      judge(
        run(
          4000,
          () => 2,
          () => 42,
        ),
        T,
        true,
      ).kind,
    ).toBe("stopped");
  });

  it("survives a track change (position jumps back)", () => {
    const pos = (t: number) => (t < 1500 ? 200 + t / 1000 : (t - 1500) / 1000);
    expect(
      judge(
        run(3000, () => 2, pos),
        T,
        false,
      ),
    ).toEqual({ kind: "playing" });
  });

  it("is inconclusive if someone pauses", () => {
    expect(
      judge(
        run(
          2000,
          (t) => (t > 1200 ? 1 : 2),
          (t) => t / 1000,
        ),
        T,
        false,
      ).kind,
    ).toBe("inconclusive");
  });
});

describe("judge with HQPlayer's ~1 s position steps", () => {
  // Position as HQPlayer reports it: whole seconds, at any phase.
  const stepped = (speed: number, phase: number, ms = DEFAULT_TIMING.maxMs) => {
    const out: Sample[] = [];
    for (let t = 0; t <= ms; t += DEFAULT_TIMING.sampleMs)
      out.push({ t, state: 2, position: Math.floor((t / 1000) * speed + phase) });
    return out;
  };
  const phases = Array.from({ length: 20 }, (_, i) => i / 20);

  it("never calls healthy playback struggling, whatever the phase", () => {
    for (const ph of phases) {
      // Every prefix, as the live watch would see it, then the final verdict.
      const all = stepped(1, ph);
      for (let n = 2; n <= all.length; n++) {
        const v = judge(all.slice(0, n), DEFAULT_TIMING, n === all.length);
        expect(["playing", "pending"]).toContain(v.kind);
      }
    }
  });

  it("still catches a real overload (0.6× and 0.75×)", () => {
    for (const speed of [0.6, 0.75])
      for (const ph of phases) expect(judge(stepped(speed, ph), DEFAULT_TIMING, true).kind).toBe("struggling");
  });
});

describe("after a rate or mode change (MAJOR_TIMING)", () => {
  /** Judge as the live watch does: one sample at a time, stopping at the first verdict. */
  const watchOver = (samples: Sample[], timing: WatchTiming) => {
    for (let n = 1; n <= samples.length; n++) {
      const v = judge(samples.slice(0, n), timing, samples[n - 1]!.t >= timing.maxMs);
      if (v.kind !== "pending") return { ...v, at: samples[n - 1]!.t };
    }
    return { kind: "pending", at: Infinity };
  };
  /** Position at `slow`× real time until `until` ms, then real time. */
  const lagThen = (slow: number, until: number) => (t: number) =>
    100 + (Math.min(t, until) * slow + Math.max(0, t - until)) / 1000;

  it("doesn't call a slow start a failure: HQPlayer restarting its processing after a rate change", () => {
    // Seen live (2026-10-06): DSD1024 + AHM7EC8B rolled back at 72%, a combination measured at 1.0x.
    const v = watchOver(
      run(MAJOR_TIMING.maxMs, () => 2, lagThen(0.6, 5000)),
      MAJOR_TIMING,
    );
    expect(v.kind).toBe("playing");
  });

  it("still catches a real overload, well within the window", () => {
    // Measured (design 2.3): ASDM7EC at DSD1024 on the Mac, 0.53x within 10 s.
    const v = watchOver(
      run(MAJOR_TIMING.maxMs, () => 2, lagThen(0.53, Infinity)),
      MAJOR_TIMING,
    );
    expect([v.kind, v.at <= 12_000]).toEqual(["struggling", true]);
  });
});
