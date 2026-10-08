// Chips (docs/design-v2-layout.md rule 2): short facts on each picker item that double as
// filters. Five kinds, each with a symbol or word so meaning never rests on colour:
// fact, good here (✓), trouble here (✗), suggested, in use. At most four shown on an item.
// Sources: HQPlayer's (or borrowed) filter rating and focus tags, the ratio class, the
// apodizing table, what the name says (phase, length), and this machine's own records.
import { ratioClass } from "@app/protocol/compat";
import type { KeptUp } from "./api.ts";

export type ChipKind = "fact" | "good" | "trouble" | "suggested" | "inuse";
export interface Chip {
  kind: ChipKind;
  label: string;
  /** What filtering by this chip keeps: rows having a chip with the same key. */
  key: string;
}

export const MAX_CHIPS = 4;

/** The phase a filter's name gives: "-lp" linear, "-mp" minimum, "-ip" intermediate. */
export function phaseOf(name: string): string | null {
  if (/-lp(-2s)?$/.test(name)) return "linear phase";
  if (/-mp(-2s)?$/.test(name) || name === "minphaseFIR") return "minimum phase";
  if (/-ip(-2s)?$/.test(name)) return "intermediate phase";
  return null;
}

/** Length words in a filter's name, or two-stage ("-2s"). */
export function lengthOf(name: string): string | null {
  if (name.endsWith("-2s")) return "two-stage";
  if (/-short(-|$)/.test(name)) return "short";
  if (/-long(-|$)/.test(name)) return "long";
  if (/-xla?(-|$)/.test(name)) return "extra long";
  return null;
}

const RATIO_WORDS: Record<string, string> = {
  any: "any ratio",
  "any-up": "any ratio",
  integer: "whole-number ratio",
  "integer-up": "whole-number ratio",
  pow2: "power-of-two ratio",
  "pow2-up": "power-of-two ratio",
};

export interface FilterItemLike {
  index: number;
  name: string;
  warn?: string;
  blocked?: string;
  rating?: number;
  tags?: string[];
  apodizing?: boolean | "partial";
}

/** A filter's chips, status first, then facts. */
export function filterChips(i: FilterItemLike, o: { inUse: boolean; keptLow?: number | null }): Chip[] {
  const out: Chip[] = [];
  if (o.inUse) out.push({ kind: "inuse", label: "in use", key: "inuse" });
  if (i.warn) out.push({ kind: "trouble", label: "✗ fell behind here", key: "trouble" });
  if (i.blocked) out.push({ kind: "trouble", label: "✗ won't play this ratio", key: "blocked" });
  if (o.keptLow != null) out.push({ kind: "good", label: `✓ kept up here (${o.keptLow.toFixed(1)}×)`, key: "kept" });
  if (i.rating === 5) out.push({ kind: "fact", label: "★ 5/5", key: "5/5" });
  const phase = phaseOf(i.name);
  if (phase) out.push({ kind: "fact", label: phase, key: `phase:${phase}` });
  if (i.apodizing === true) out.push({ kind: "fact", label: "apodizing", key: "apodizing" });
  else if (i.apodizing === "partial") out.push({ kind: "fact", label: "½ apodizing", key: "apodizing-partial" });
  const ratio = RATIO_WORDS[ratioClass(i.name) ?? ""];
  if (ratio) out.push({ kind: "fact", label: ratio, key: `ratio:${ratio}` });
  for (const t of i.tags ?? []) out.push({ kind: "fact", label: t, key: `tag:${t}` });
  const length = lengthOf(i.name);
  if (length) out.push({ kind: "fact", label: length, key: `length:${length}` });
  return out;
}

export function shown(chips: Chip[]): { chips: Chip[]; more: number } {
  return { chips: chips.slice(0, MAX_CHIPS), more: Math.max(0, chips.length - MAX_CHIPS) };
}

/** Rows that have every chosen chip. */
export function narrow<T extends { chips: Chip[] }>(rows: T[], keys: Set<string>): T[] {
  return rows.filter((r) => [...keys].every((k) => r.chips.some((c) => c.key === k)));
}

/** The order filters are offered in: status, the guide's start, then rating, phase, apodizing, ratio, focus, length. */
const RANK = ["trouble", "blocked", "kept", "start:", "5/5", "phase:", "apodizing", "ratio:", "tag:", "length:", "heavy"];
const rank = (key: string) => {
  const i = RANK.findIndex((r) => key === r || (r.endsWith(":") && key.startsWith(r)) || key.startsWith(r));
  return i < 0 ? RANK.length : i;
};

/** Chips worth offering as filters: on some rows but not all (those would narrow nothing), in a steady order. */
export function facets(lists: Chip[][]): (Chip & { count: number })[] {
  const seen = new Map<string, Chip & { count: number }>();
  for (const list of lists)
    for (const c of new Map(list.map((x) => [x.key, x])).values()) {
      const f = seen.get(c.key);
      if (f) f.count++;
      else seen.set(c.key, { ...c, count: 1 });
    }
  return [...seen.values()]
    .filter((f) => f.count < lists.length && f.kind !== "inuse")
    .sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
}

/**
 * "Kept up here" for a filter: the worst settled low among this machine's records with the
 * filter in that slot, at this mode and output rate (server kept-up.ts); null when none.
 */
export function keptLowFor(list: KeptUp[], q: { mode: string; rateHz: number; slot: "1x" | "Nx"; name: string }): number | null {
  const lows = list
    .filter((k) => k.mode === q.mode && k.rateHz === q.rateHz && (q.slot === "1x" ? k.filter1x : k.filterNx) === q.name)
    .map((k) => k.low);
  return lows.length ? Math.min(...lows) : null;
}

/** Chip families shown as one drop-down each (a choice of one), the rest stay chips. */
export const GROUPS = [
  { prefix: "phase:", label: "Phase" },
  { prefix: "ratio:", label: "Ratio" },
  { prefix: "tag:", label: "Focus" },
  { prefix: "length:", label: "Length" },
] as const;

/** The offered facets split into loose chips and drop-down groups (owner's call, 2026-10-08). */
export function grouped(
  f: (Chip & { count: number })[],
  families: readonly { prefix: string; label: string }[] = GROUPS,
): {
  chips: (Chip & { count: number })[];
  groups: { prefix: string; label: string; options: (Chip & { count: number })[] }[];
} {
  return {
    chips: f.filter((c) => !families.some((g) => c.key.startsWith(g.prefix))),
    groups: families.map((g) => ({ ...g, options: f.filter((c) => c.key.startsWith(g.prefix)) })).filter((g) => g.options.length),
  };
}

/** Choose one option in a group (or none: ""), dropping the group's other choice. */
export function chooseInGroup(keys: Set<string>, prefix: string, key: string): void {
  for (const k of [...keys]) if (k.startsWith(prefix)) keys.delete(k);
  if (key) keys.add(key);
}
