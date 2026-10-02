// Did playback survive a change? Judged from Status samples taken after it.
//
// Measured failure: an invalid rate/modulator combination goes state 3 → 0 and
// stays stopped (design §2.3). Inferred, not yet measured: a CPU/GPU overload
// shows as position advancing slower than real time while state stays 2.
// Overload can leave an instance needing a restart (operator report), so slow
// progress is judged early rather than at the end of the window.

export interface Sample {
  /** ms since the watch started */
  t: number;
  state: number;
  /** seconds */
  position: number;
}

export interface WatchTiming {
  /** Ignore this long after the change: filters pause briefly (≤ ~1 s, measured). */
  graceMs: number;
  /** Healthy progress needed after the grace period to pass early. */
  healthyMs: number;
  /** Give up and judge with what we have. */
  maxMs: number;
  sampleMs: number;
  /** Below this fraction of real time counts as not keeping up. */
  minSpeed: number;
}

export const DEFAULT_TIMING: WatchTiming = { graceMs: 1500, healthyMs: 1500, maxMs: 6000, sampleMs: 250, minSpeed: 0.85 };
/** Mode changes take ~3 s before HQPlayer replies (measured); allow more after. */
export const MAJOR_TIMING: WatchTiming = { ...DEFAULT_TIMING, graceMs: 2500, maxMs: 10000 };

export type Verdict =
  | { kind: "playing" }
  | { kind: "stopped"; detail: string }
  | { kind: "struggling"; detail: string }
  /** Someone paused during the watch: no judgement either way. */
  | { kind: "inconclusive"; detail: string }
  /** Not enough evidence yet. */
  | { kind: "pending" };

/** Judge samples so far. `final` = no more samples coming. */
export function judge(samples: Sample[], timing: WatchTiming, final: boolean): Verdict {
  if (samples.some((s) => s.state === 1)) return { kind: "inconclusive", detail: "playback was paused during the check" };
  const after = samples.filter((s) => s.t >= timing.graceMs);
  if (after.length < 2) return final ? { kind: "inconclusive", detail: "too few samples" } : { kind: "pending" };

  const last = after[after.length - 1]!;
  const stoppedFor = (() => {
    let since: number | null = null;
    for (const s of after) since = s.state === 2 ? null : (since ?? s.t);
    return since === null ? 0 : last.t - since;
  })();
  if (stoppedFor >= 1000 || (final && last.state !== 2))
    return { kind: "stopped", detail: last.state === 3 ? "HQPlayer is stopping playback" : "playback stopped" };

  // Progress over the trailing healthy window, restarting after a track change
  // (position jumps backwards) or any non-playing sample.
  let start = 0;
  for (let i = 1; i < after.length; i++) {
    if (after[i]!.position < after[i - 1]!.position - 0.5 || after[i]!.state !== 2) start = i;
  }
  const run = after.slice(start);
  const span = run[run.length - 1]!.t - run[0]!.t;
  if (span < timing.healthyMs) return final ? judgeSpeed(run, timing, true) : { kind: "pending" };
  return judgeSpeed(run, timing, final);
}

function judgeSpeed(run: Sample[], timing: WatchTiming, final: boolean): Verdict {
  const a = run[0]!;
  const b = run[run.length - 1]!;
  const wall = (b.t - a.t) / 1000;
  if (wall <= 0) return final ? { kind: "inconclusive", detail: "too few samples" } : { kind: "pending" };
  const speed = (b.position - a.position) / wall;
  if (speed >= timing.minSpeed) return { kind: "playing" };
  // Consistently slow for twice the healthy window: don't wait for the deadline.
  if (!final && b.t - a.t < 2 * timing.healthyMs) return { kind: "pending" };
  return speed <= 0.05
    ? { kind: "stopped", detail: "position is not advancing" }
    : { kind: "struggling", detail: `playing at ${(speed * 100).toFixed(0)}% of real time` };
}

/** Sample until a verdict is reached or time runs out. */
export async function watchPlayback(
  sample: () => Promise<{ state: number; position: number }>,
  timing: WatchTiming,
): Promise<Verdict> {
  const t0 = Date.now();
  const samples: Sample[] = [];
  for (;;) {
    const s = await sample();
    const t = Date.now() - t0;
    samples.push({ t, ...s });
    const final = t >= timing.maxMs;
    const v = judge(samples, timing, final);
    if (v.kind !== "pending") return v;
    await new Promise((r) => setTimeout(r, timing.sampleMs));
  }
}
