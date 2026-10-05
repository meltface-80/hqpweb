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

/**
 * Speed as the least-squares slope of position over time. HQPlayer reports
 * position in ~1 s steps (measured), so two samples 3 s apart can read 2 s of
 * progress while playback is fine (0.67×); a fit over every sample doesn't
 * swing like that.
 */
export function fittedSpeed(run: Sample[]): number | null {
  if (run.length < 2) return null;
  const n = run.length;
  const mt = run.reduce((acc, s) => acc + s.t / 1000, 0) / n;
  const mp = run.reduce((acc, s) => acc + s.position, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of run) {
    num += (s.t / 1000 - mt) * (s.position - mp);
    den += (s.t / 1000 - mt) ** 2;
  }
  return den > 0 ? num / den : null;
}

function judgeSpeed(run: Sample[], timing: WatchTiming, final: boolean): Verdict {
  const a = run[0]!;
  const b = run[run.length - 1]!;
  const speed = fittedSpeed(run);
  if (speed === null || b.t <= a.t) return final ? { kind: "inconclusive", detail: "too few samples" } : { kind: "pending" };
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

/**
 * Getting playback back after a rollback. Roon resumes by itself once the settings are
 * valid again (measured, design §2.3). HQPlayer's own playlist doesn't, and Play alone
 * then leaves it reporting "playing" with the position stuck; Stop, then Play, resumes
 * it (all measured on 5.35.10, 2026-10-04). So do that, but only if it was playing
 * before the change and Roon wasn't the source: it restores what was happening.
 */
