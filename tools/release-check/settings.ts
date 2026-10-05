// The release check's snapshot and comparison (docs/release-checklist.md), kept pure
// so the comparison can be tested. Settings are compared by name, never by index
// (CLAUDE.md rule 5: lists depend on the mode and engine).
import type { Filter, Mode, Rate, Shaper, State } from "@app/protocol";

export interface Lists {
  modes: Mode[];
  filters: Filter[];
  shapers: Shaper[];
  rates: Rate[];
}

/** What the check restores, by name. Volume is kept apart: it's only ever lowered. */
export interface Named {
  mode: string;
  /** Hz; 0 is auto. */
  rate: number;
  filter1x: string;
  filterNx: string;
  shaper: string;
  invert: boolean;
  filter20k: boolean;
  adaptive: boolean;
  convolution: boolean;
  matrixProfile: string;
  volume: number;
}

const nameAt = (list: { index: number; name: string }[], i: number) => list.find((x) => x.index === i)?.name ?? `#${i}`;

export function named(s: State, l: Lists): Named {
  return {
    mode: nameAt(l.modes, s.mode),
    rate: l.rates.find((r) => r.index === s.rate)?.rate ?? -1,
    filter1x: nameAt(l.filters, s.filter1x),
    filterNx: nameAt(l.filters, s.filterNx),
    shaper: nameAt(l.shapers, s.shaper),
    invert: s.invert,
    filter20k: s.filter20k,
    adaptive: s.adaptive,
    convolution: s.convolution,
    matrixProfile: s.matrixProfile,
    volume: s.volume,
  };
}

export interface Comparison {
  /** Settings that didn't come back: the check failed to restore them. */
  differs: string[];
  /** The volume ended lower than it started: expected, since tests only ever lower it. */
  volumeNote?: string;
}

const EPS = 0.01;

/** Compare the end state with the snapshot. A volume above the start is a failure. */
export function compare(before: Named, after: Named): Comparison {
  const differs: string[] = [];
  let volumeNote: string | undefined;
  for (const k of Object.keys(before) as (keyof Named)[]) {
    const a = before[k];
    const b = after[k];
    if (k === "volume") {
      const d = (b as number) - (a as number);
      if (d > EPS) differs.push(`volume: ${a} → ${b} dB (higher than at the start)`);
      else if (d < -EPS)
        volumeNote = `volume ended at ${b} dB, ${(-d).toFixed(1)} dB below the start (${a} dB); raise it yourself if you want it back`;
    } else if (a !== b) differs.push(`${k}: ${String(a)} → ${String(b)}`);
  }
  return { differs, ...(volumeNote ? { volumeNote } : {}) };
}
