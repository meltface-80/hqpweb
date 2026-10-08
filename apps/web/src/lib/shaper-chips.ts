// Chips for the modulator and dither lists in the v2 layout (docs/design-v2-layout.md
// rule 2), as filter chips are in chips.ts. Every fact comes from the advice data
// (advice/catalogue.ts families, advice/variants.ts load, the guide's starting point) or
// from this machine's records; the guide's own words are reused where they fit ("For your answers").
import type { KeptUp } from "./api.ts";
import { orderOf } from "./advice/catalogue.ts";
import { heavyAt, variantNote } from "./advice/variants.ts";
import type { Chip } from "./chips.ts";

export interface ShaperItemLike {
  name: string;
  /** "won't play: …" for a rate it can't play (hints.ts decorate), else a failure here. */
  warn?: string;
  gen?: number;
}

export type Badge = { text: string; kind: "default" | "yours" | "caution" };

/** A modulator's or dither's chips: status, the guide's start, then order, load and generation. */
export function shaperChips(
  i: ShaperItemLike,
  o: { isSdm: boolean; inUse: boolean; rateHz: number; keptLow?: number | null; badge?: Badge },
): Chip[] {
  const out: Chip[] = [];
  if (o.inUse) out.push({ kind: "inuse", label: "in use", key: "inuse" });
  if (i.warn?.startsWith("won't play")) out.push({ kind: "trouble", label: "✗ won't play at this rate", key: "blocked" });
  else if (i.warn) out.push({ kind: "trouble", label: "✗ fell behind here", key: "trouble" });
  if (o.keptLow != null) out.push({ kind: "good", label: `✓ kept up here (${o.keptLow.toFixed(1)}×)`, key: "kept" });
  if (o.badge && o.badge.kind !== "caution") out.push({ kind: "suggested", label: o.badge.text, key: `start:${o.badge.kind}` });
  if (o.isSdm) {
    const order = orderOf(i.name);
    if (order) out.push({ kind: "fact", label: order === 5 ? "fifth order" : "seventh order", key: `order:${order}` });
    // Signalyst ranks load only among a line's variants, so the chip names the line:
    // "EC line: heaviest" can't be read as this machine's load ("kept up here" is that).
    const load = variantNote(i.name)?.load;
    const line = i.name.startsWith("AHM") ? "AHM" : "EC line";
    if (load) out.push({ kind: "fact", label: `${line}: ${load}`, key: `load:${line}: ${load}` });
    // What Signalyst says it takes, not how it went here; a note on the row, not a filter.
    if (o.rateHz && heavyAt(i.name, o.rateHz))
      out.push({ kind: "fact", label: "needs a fast CPU at this rate", key: "fast-cpu" });
  }
  if (i.gen !== undefined) out.push({ kind: "fact", label: `Gen ${i.gen}`, key: `gen:${i.gen}` });
  return out;
}

/** The drop-downs for these lists (chips.ts grouped). No family: the list's sections are the families. */
export const SHAPER_GROUPS = [
  { prefix: "order:", label: "Order" },
  { prefix: "load:", label: "Load in its line" },
  { prefix: "gen:", label: "Gen" },
] as const;

/** "Kept up here" for a modulator or dither: the worst settled low at this mode and rate. */
export function keptLowForShaper(list: KeptUp[], q: { mode: string; rateHz: number; name: string }): number | null {
  const lows = list.filter((k) => k.mode === q.mode && k.rateHz === q.rateHz && k.shaper === q.name).map((k) => k.low);
  return lows.length ? Math.min(...lows) : null;
}
