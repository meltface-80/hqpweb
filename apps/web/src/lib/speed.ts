// The "Processing" figure on the Now card (moved from App.svelte; pure, tested in speed.test.ts).

export type SpeedClass = "" | "ok" | "warn" | "bad";

/** hqpweb's position fit below this is "slow"; amber once it lasts 15 s (see speedClass). */
export const isSlow = (speed: number | null) => speed != null && speed < 0.97;
/** Normal replies take ~1 ms on a kept-open connection (measured); over 1.5 s, HQPlayer may be overloaded. */
export const answersSlowly = (latencyMs: number | undefined) => (latencyMs ?? 0) > 1500;

/**
 * HQPlayer 5.17.2+ reports its own processing speed (× real time): when it does, judge
 * that. Calibrated on a real instance: 1.00× just holds, 0.92× falls behind, so red below
 * 1×, amber below 1.15× (little headroom). Otherwise judge hqpweb's 30 s position fit:
 * red below 0.90, amber after 15 s below 0.97.
 * `slowForMs`: how long the fit has been below 0.97, or null if it isn't.
 */
export function speedClass(processSpeed: number | null, speed: number | null, slowForMs: number | null): SpeedClass {
  if (processSpeed != null) return processSpeed < 1 ? "bad" : processSpeed < 1.15 ? "warn" : "ok";
  if (speed == null) return "";
  if (speed < 0.9) return "bad";
  return slowForMs !== null && slowForMs >= 15_000 ? "warn" : "ok";
}

const LABEL: Record<SpeedClass, string> = { "": "—", ok: "Real-time ✓", warn: "Straining", bad: "Falling behind" };
const fmtX = (v: number) => (v >= 10 ? `${Math.round(v)}×` : `${v.toFixed(1)}×`);

export const speedText = (processSpeed: number | null, speed: number | null, cls: SpeedClass) =>
  processSpeed != null ? fmtX(processSpeed) : speed == null ? "—" : LABEL[cls];

export const speedTitle = (processSpeed: number | null, speed: number | null) =>
  processSpeed != null
    ? `HQPlayer is processing at ${processSpeed.toFixed(1)}× real time (3-second average): it could run that many times faster than playback needs. Below 1× it can't keep up and audio drops; close to 1× leaves little headroom.`
    : speed == null
      ? "Shown while playing, after about 30 s of a track."
      : `HQPlayer is processing at ${speed.toFixed(3)}× real time over the last 30 s. Below 1.0 it can't keep up and audio will drop. Brief dips during a change are normal.`;

/** Readings in a row below real time before the alarm (HQPTuner uses 3 too): one dip isn't an overload. */
export const SUSTAIN = 3;
/** The count of consecutive readings below real time (1×), after this one. */
export const behindStreak = (streak: number, processSpeed: number | null) =>
  processSpeed != null && processSpeed < 1 ? streak + 1 : 0;
export const lasting = (streak: number) => streak >= SUSTAIN;
