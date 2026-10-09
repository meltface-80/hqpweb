// Holding the meter back so it lines up with what's heard. HQPlayer's meter shows the music
// before its output buffer, so it runs ahead of the room by about that buffer, which is set
// in HQPlayer itself (and the NAA and DAC add their own, which HQPlayer can't see). Auto
// waits HQPlayer's reported output delay less hqpweb's own lag; a nudge, set by ear, covers
// the rest.

/**
 * hqpweb's own lag before a meter frame is drawn: ~0.2 s from HQPlayer's position to its
 * meter port (measured, Desktop 5.32.5) plus the server's pacing buffer (~0.3 s, estimated).
 */
export const OWN_LAG_MS = 500;
export const NUDGE_STEP_MS = 100;
export const NUDGE_RANGE = { min: -2000, max: 3000 } as const;

/** How long to hold each meter update: never negative. */
export function meterDelayMs(outputDelayMs: number | null | undefined, nudgeMs: number): number {
  return Math.max(0, Math.max(0, (outputDelayMs ?? 0) - OWN_LAG_MS) + nudgeMs);
}

export const clampNudge = (ms: number) => Math.min(NUDGE_RANGE.max, Math.max(NUDGE_RANGE.min, Math.round(ms)));

/** Updates held until their time: `take` gives the newest one due, dropping older ones. */
export class DelayLine<T> {
  private q: { at: number; v: T }[] = [];
  private readonly max: number;
  constructor(max = 400) {
    this.max = max;
  }
  push(at: number, v: T) {
    this.q.push({ at, v });
    if (this.q.length > this.max) this.q.splice(0, this.q.length - this.max);
  }
  take(now: number, delayMs: number): T | undefined {
    let out: T | undefined;
    while (this.q.length && this.q[0]!.at <= now - delayMs) out = this.q.shift()!.v;
    return out;
  }
  clear() {
    this.q = [];
  }
}
