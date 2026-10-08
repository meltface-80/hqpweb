// The meter's drawing rules (docs/design-v2-layout.md rule 9), pure so they're tested here;
// MeterStrip.svelte draws with them. The server sends levels and 48 bands per channel in dB
// (server meter-stream.ts).

/** -100..0 dB → 0..1. */
export const norm = (db: number) => Math.max(0, Math.min(1, (db + 100) / 100));

/** The louder channel per band, for the views that show one row. */
export const mono = (bands: number[][]): number[] =>
  bands[0]!.map((v, i) => Math.max(v, ...bands.slice(1).map((b) => b[i] ?? v)));

/** Waterfall colour: dark blue (quiet) to bright yellow (loud). */
export const heat = (db: number) => {
  const v = norm(db);
  return `hsl(${Math.round(230 - v * 180)} 80% ${Math.round(8 + v * 52)}%)`;
};

/** Each band's highest recent value: held for `holdMs`, then falling at `fallDbPerS`. */
export class PeakHold {
  values: number[] = [];
  private at: number[] = [];
  private readonly holdMs: number;
  private readonly fall: number;
  constructor(holdMs = 1500, fallDbPerS = 20) {
    this.holdMs = holdMs;
    this.fall = fallDbPerS;
  }
  update(bands: number[], now: number) {
    bands.forEach((v, i) => {
      const held = this.values[i];
      const since = now - (this.at[i] ?? now);
      const fallen =
        held === undefined ? -Infinity : since > this.holdMs ? held - ((since - this.holdMs) / 1000) * this.fall : held;
      if (held === undefined || v >= fallen) {
        this.values[i] = v;
        this.at[i] = now;
      } else this.values[i] = fallen;
    });
  }
}

/** What the strip says instead of drawing, when it can't. */
export function meterNote(e: { live: boolean; connected: boolean }, playing: boolean): string {
  if (e.live) return "";
  if (!e.connected) return "No meter from this HQPlayer";
  return playing ? "Quiet" : "Not playing";
}
