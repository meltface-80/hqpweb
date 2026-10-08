// Compare (docs/design-v2-layout.md; canvas I5): two full settings cards, A as it was
// playing when Compare opened and B to choose, heard in turn. The rules live here; the
// sheet is CompareSheet.svelte. Sides are kept by name and resolved by the server at the
// moment of use (CLAUDE.md rule 5); which side is heard is read from State, never assumed.
import type { Capabilities, Change, Snapshot } from "./api.ts";
import { nameAt } from "./hints.ts";

export interface Side {
  mode: string;
  filter1x: string;
  filterNx: string;
  shaper: string;
  /** Output rate in Hz; 0 = auto. */
  rate: number;
}
export const FIELDS = ["mode", "filter1x", "filterNx", "shaper", "rate"] as const;
export type Field = (typeof FIELDS)[number];

/** What's playing now, by name. */
export function nowSide(caps: Capabilities, snap: Snapshot): Side {
  return {
    mode: caps.mode.name,
    filter1x: nameAt(caps.filters, snap.state.filter1x),
    filterNx: nameAt(caps.filters, snap.state.filterNx),
    shaper: nameAt(caps.shapers, snap.state.shaper),
    rate: caps.rates.find((r) => r.index === snap.state.rate)?.rate ?? 0,
  };
}

export interface Choices {
  filters: string[];
  shapers: string[];
  rates: { rate: number; allowed: boolean }[];
}

/** A mode's choices: live for the mode in use, else as last read (server history.ts); null when never seen. */
export function choicesFor(caps: Capabilities, mode: string): Choices | null {
  if (mode === caps.mode.name)
    return { filters: caps.filters.map((f) => f.name), shapers: caps.shapers.map((s) => s.name), rates: caps.rates };
  return caps.modeLists[mode] ?? null;
}

/** The modes a side can take: [source] has no settings of its own to compare. */
export const comparableModes = (caps: Capabilities) => caps.modes.filter((m) => m.value !== -1).map((m) => m.name);

/**
 * A side moved to another mode: that mode's settings as last seen there, else the same
 * names (which the server reports if that mode lacks them), at auto.
 */
export function inMode(side: Side, mode: string, caps: Capabilities): Side {
  if (mode === side.mode) return side;
  const seen = caps.lastSeen[mode];
  return seen
    ? { mode, filter1x: seen.filter1x, filterNx: seen.filterNx, shaper: seen.shaper, rate: seen.rate }
    : { ...side, mode, rate: 0 };
}

/** A preset on a side: its fields over the side as moved to the preset's mode. */
export function withPreset(side: Side, preset: Change, caps: Capabilities): Side {
  const base = preset.mode ? inMode(side, preset.mode, caps) : side;
  const out = { ...base };
  for (const f of FIELDS) if (preset[f] !== undefined) (out as Record<Field, unknown>)[f] = preset[f];
  return out;
}

export function differs(a: Side, b: Side): Set<Field> {
  return new Set(FIELDS.filter((f) => a[f] !== b[f]));
}
export const same = (a: Side, b: Side) => differs(a, b).size === 0;

/**
 * The change that makes `target` play, from `now`: only what differs. Across a mode
 * switch the rate always goes along (0 for auto), so the server doesn't put back that
 * mode's last-seen rate instead.
 */
export function changeFor(target: Side, now: Side): Change {
  const d = differs(target, now);
  const c: Change = {};
  for (const f of FIELDS) if (d.has(f) || (f === "rate" && d.has("mode"))) (c as Record<Field, unknown>)[f] = target[f];
  return c;
}

/** All of a side, for saving it as a preset. */
export const asSettings = (s: Side): Change => ({ ...s });

/** Which side is playing, read from State: "A", "B", or null for neither (changed elsewhere, rolled back). */
export function hearing(now: Side, a: Side, b: Side): "A" | "B" | null {
  if (same(now, a)) return "A";
  if (same(now, b)) return "B";
  return null;
}

/** What switching between the two costs, in plain words. */
export function switchNote(a: Side, b: Side): string[] {
  const d = differs(a, b);
  if (d.size === 0) return ["A and B are the same. Change something on B."];
  if (d.has("mode"))
    return [
      "Different modes: each switch pauses about 5 s, then carries on.",
      "Levels aren't matched: DSD and PCM can play at different loudness.",
    ];
  if (d.has("rate")) return ["Different rates: each switch has a gap of a few seconds."];
  return ["Only filters or shaping differ: the quickest switch."];
}
