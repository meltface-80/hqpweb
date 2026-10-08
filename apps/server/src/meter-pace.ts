// Pacing HQPlayer's meter frames for display (docs/design-v2-layout.md rule 9). They come
// in bursts (~12 frames at once, ~4 times a second, measured 2026-10-08), so showing the
// newest at each tick would jerk 4 times a second. Keeping ~0.3 s queued and taking two
// frames per 50 ms tick (≈ the 43 fps PCM rate) moves smoothly. In DSD (~180 fps) the
// queue fills faster and is trimmed, which skips frames but keeps the delay bounded.

/** Frames kept back before showing (~0.3 s at 43 fps). */
const KEEP = 14;
/** Most frames queued; older ones are dropped to bound the delay. */
const MAX = 30;
/** No frame for this long: the meter isn't live (it's quiet 2.6–5 s at track and rate changes). */
const QUIET_MS = 3000;

export class MeterPacer<T> {
  private queue: T[] = [];
  private shown: T | null = null;
  private last = -Infinity;

  push(frame: T, now: number) {
    this.queue.push(frame);
    this.last = now;
    if (this.queue.length > MAX) this.queue.splice(0, this.queue.length - MAX);
  }

  /** The frame to show at this tick (call every ~50 ms). */
  take(now: number): T | null {
    if (this.queue.length > KEEP || (this.queue.length && now - this.last > 400)) {
      for (let i = 0; i < 2 && this.queue.length; i++) this.shown = this.queue.shift()!;
    }
    return this.shown;
  }

  /** Frames are still coming. */
  live(now: number): boolean {
    return now - this.last < QUIET_MS;
  }
}
