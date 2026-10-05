// How a preset relates to an instance right now: what differs, what this instance can't
// take, and whether a rule says the result won't play. Pure; Instance.previewPresets reads.
import { filterSlot, predictedStop, type Hint, type Status } from "@app/protocol";
import type { Capabilities, Change, Field } from "./instance.ts";
import type { Settings } from "./settings.ts";
import { VOLUME_EPS } from "./volume.ts";

/** Settings whose meaning depends on the mode they were chosen in. */
export const MODE_BOUND = ["rate", "filterNx", "filter1x", "shaper"] as const;

export interface PresetPreview {
  /** active = already in effect; quick/major as in design §4.2. */
  kind: "active" | "quick" | "major";
  differs: Field[];
  /** Settings this instance can't take now; they'd be skipped. */
  missing: { field: Field; reason: string }[];
  /** True when the preset switches mode, so names are checked only at apply time. */
  unchecked: boolean;
  /** A rule says the resulting combination won't play. */
  predicted?: Hint;
}

export function previewOne(p: Change, caps: Capabilities, cur: Settings, status: Status): PresetPreview {
  const fields = (Object.keys(p) as Field[]).filter((k) => p[k] !== undefined);
  const differs = fields.filter((f) => (f === "volume" ? Math.abs(cur.volume - p.volume!) > VOLUME_EPS : cur[f] !== p[f]));
  const switchesMode = p.mode !== undefined && p.mode !== cur.mode;
  const kind: PresetPreview["kind"] =
    differs.length === 0 ? "active" : switchesMode || (p.rate !== undefined && p.rate !== cur.rate) ? "major" : "quick";
  const missing: { field: Field; reason: string }[] = [];
  if (p.matrixProfile !== undefined && !caps.matrixProfiles.includes(p.matrixProfile))
    missing.push({ field: "matrixProfile", reason: `matrix profile "${p.matrixProfile}" isn't set up here` });
  if (switchesMode) {
    if (caps.modes.some((m) => m.name === p.mode)) return { kind, differs, missing, unchecked: true };
    missing.unshift({ field: "mode", reason: `mode "${p.mode}" is not available here` });
    for (const f of MODE_BOUND) if (p[f] !== undefined) missing.push({ field: f, reason: `belongs to mode "${p.mode}"` });
    return { kind, differs, missing, unchecked: false };
  }
  const has = (list: { name: string }[], n?: string) => n === undefined || list.some((x) => x.name === n);
  if (!has(caps.filters, p.filterNx)) missing.push({ field: "filterNx", reason: `"${p.filterNx}" isn't available here` });
  if (!has(caps.filters, p.filter1x)) missing.push({ field: "filter1x", reason: `"${p.filter1x}" isn't available here` });
  if (!has(caps.shapers, p.shaper)) missing.push({ field: "shaper", reason: `"${p.shaper}" isn't available here` });
  if (p.rate !== undefined) {
    const opt = caps.rates.find((r) => r.rate === p.rate);
    if (!opt) missing.push({ field: "rate", reason: `${p.rate} Hz isn't offered here` });
    else if (!opt.allowed) missing.push({ field: "rate", reason: opt.note ?? "above this instance's limit" });
  }
  // Would the resulting combination play? Only knowable with a source and a fixed rate.
  const source = status.source?.sampleRate;
  const rate = p.rate ?? cur.rate;
  let predicted: Hint | undefined;
  if (source && rate) {
    const filter = filterSlot(source) === "1x" ? (p.filter1x ?? cur.filter1x) : (p.filterNx ?? cur.filterNx);
    predicted = predictedStop({
      mode: cur.mode,
      filter,
      shaper: p.shaper ?? cur.shaper,
      sourceRate: source,
      outputRate: rate,
      filterDescription: caps.filters.find((f) => f.name === filter)?.description,
    });
  }
  return { kind, differs, missing, unchecked: false, ...(predicted ? { predicted } : {}) };
}
