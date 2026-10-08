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

/**
 * Where each band sits across a width, by its real frequency span on a log scale
 * (edges in Hz, one more than bands). Low bands cover a bin each, so they come out wider
 * than they would as equal slots: drawn as they are, not duplicated (seen on the owner's test build).
 */
export function bandBoxes(edgesHz: number[], width: number): { x: number; w: number }[] {
  const lo = Math.log(edgesHz[0]!);
  const span = Math.log(edgesHz[edgesHz.length - 1]!) - lo;
  const at = (hz: number) => ((Math.log(hz) - lo) / span) * width;
  return edgesHz.slice(0, -1).map((hz, i) => ({ x: at(hz), w: at(edgesHz[i + 1]!) - at(hz) }));
}

/**
 * Frequency ticks for the axis, placed by the same log scale as the bands (0..1 across):
 * 20 Hz, 200, 2k and 20 kHz where they fall inside the edges, or within 2% of them.
 */
export function freqTicks(edgesHz: number[]): { label: string; x: number }[] {
  const lo = Math.log(edgesHz[0]!);
  const span = Math.log(edgesHz[edgesHz.length - 1]!) - lo;
  return [
    [20, "20 Hz"],
    [200, "200"],
    [2000, "2k"],
    [20_000, "20 kHz"],
  ]
    .map(([hz, label]) => ({ label: label as string, x: (Math.log(hz as number) - lo) / span }))
    .filter((t) => t.x >= -0.02 && t.x <= 1.02) // a tick just past an edge (20 Hz vs a 21.5 Hz first bin) sits on it
    .map((t) => ({ ...t, x: Math.min(1, Math.max(0, t.x)) }));
}

/** dB gridlines every 20 dB over norm's range, as heights 0..1 from the bottom. */
export const dbTicks = (): { label: string; y: number }[] =>
  [0, -20, -40, -60, -80].map((db) => ({ label: db === 0 ? "0 dB" : `${db}`, y: norm(db) }));

/** The strip's words for the two channels' peaks, e.g. "Peak L −32.5 · R −31.6 dB". */
export function peakWords(levels: number[][] | undefined): string {
  const pk = (l: number[] | undefined) => (l?.[1] === undefined || l[1] <= -120 ? "—" : l[1].toFixed(1).replace("-", "−"));
  if (!levels?.length) return "";
  return levels.length === 1 ? `Peak ${pk(levels[0])} dB` : `Peak L ${pk(levels[0])} · R ${pk(levels[1])} dB`;
}
