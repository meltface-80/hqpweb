// What the pickers, the rate sheet and the warnings say about each choice (moved from
// App.svelte; pure, tested in hints.test.ts). The rules themselves are in @app/protocol/compat.
import {
  MODULATOR_NOTE,
  compatibleRates,
  ditherHint,
  filterNotes,
  filterSlot,
  isApodizing,
  modulatorGen,
  modulatorHint,
  ratioHint,
  type Hint,
} from "@app/protocol/compat";
import { formatRate, knownBad, type Capabilities, type Combo, type Snapshot } from "./api.ts";

export type Slot = "filter1x" | "filterNx";

export const nameAt = (list: { index: number; name: string }[] | undefined, i: number | undefined) =>
  list?.find((x) => x.index === i)?.name ?? "";

/** What every hint needs to know about the instance right now. */
export interface Ctx {
  caps: Capabilities;
  snap: Snapshot;
  isSdm: boolean;
  /** The source: what's playing, or else the track HQPlayer's playlist would play next. */
  source: number;
  /** Rate is fixed (not auto): only then can a filter choice make the ratio impossible. */
  fixedRate: boolean;
  /** The configured rate when fixed (active_rate can be stale while stopped), else what's active. */
  outRate: number;
  /** HQPlayer 6 describes each filter and modulator; v5 describes nothing (see filterNotes). */
  described: boolean;
  shapersDescribed: boolean;
  /** The combination in use now, by name, for matching known failures. */
  combo: Combo;
  shaperName: string;
  /** The filter the source uses (1x below 50 kHz, manual §4.6), or "" with no source. */
  inUseFilter: string;
}

export function context(caps: Capabilities, snap: Snapshot): Ctx {
  // A track that can't start leaves Status blank (measured), so the queue is the only clue.
  const source = snap.status.source?.sampleRate || snap.queuedRate || 0;
  const fixedRate = snap.state.rate !== 0;
  const shaperName = nameAt(caps.shapers, snap.state.shaper);
  return {
    caps,
    snap,
    isSdm: caps.mode.name.startsWith("SDM"),
    source,
    fixedRate,
    outRate: (fixedRate ? caps.rates.find((r) => r.index === snap.state.rate)?.rate : 0) || snap.status.activeRate || 0,
    described: caps.filters.some((f) => f.description),
    shapersDescribed: caps.shapers.some((s) => s.description),
    combo: {
      mode: caps.mode.name,
      rateHz: snap.status.activeRate,
      filterNx: nameAt(caps.filters, snap.state.filterNx),
      filter1x: nameAt(caps.filters, snap.state.filter1x),
      shaper: shaperName,
    },
    shaperName,
    inUseFilter: source ? nameAt(caps.filters, filterSlot(source) === "1x" ? snap.state.filter1x : snap.state.filterNx) : "",
  };
}

/** HQPlayer's own ratio class for a filter when it gives one (v6), else ours. */
export const ratioOf = (c: Ctx, name: string) =>
  filterNotes(name, c.caps.filters.find((f) => f.name === name)?.description, c.isSdm, c.described)?.ratio;

/** Warning text if switching `field` to `value` gives a combination that failed here before. */
const warnFor = (c: Ctx, field: keyof Combo, value: string | number) => {
  const f = knownBad(c.caps.knownBad, { ...c.combo, [field]: value });
  return f ? `failed here before at these settings (${f.reason})` : undefined;
};

/** Rule hints (manual) first, then learned failures. Hard → warning, soft → note. */
const decorate = <T extends { name: string }>(i: T, rule: Hint | undefined, learned: string | undefined, note?: string) => ({
  ...i,
  warn: rule?.level === "hard" ? `won't play: ${rule.text}` : learned,
  note: [note, rule?.level === "soft" ? rule.text : undefined].filter(Boolean).join(" · ") || undefined,
});

/**
 * A filter that can't do the current ratio is "blocked" rather than warned: the picker
 * hides it by default, and picking it offers rates that fit (RateSwitch).
 */
export function filterItems(c: Ctx, slot: "1x" | "Nx") {
  return c.caps.filters.map((f) => {
    const info = filterNotes(f.name, f.description, c.isSdm, c.described);
    const rule =
      c.source && c.fixedRate && filterSlot(c.source) === slot
        ? ratioHint(f.name, c.source, c.outRate, c.isSdm, info?.ratio)
        : undefined;
    return {
      ...decorate(f, rule?.level === "hard" ? undefined : rule, warnFor(c, slot === "1x" ? "filter1x" : "filterNx", f.name)),
      // The row already shows the name: "needs a power-of-two ratio; 44.1k → 192k is 4.35×".
      ...(rule?.level === "hard" ? { blocked: rule.text.replace(`${f.name} `, "") } : {}),
      ...(info ? { rating: info.rating, tags: info.tags, ratioText: info.ratioText } : {}),
      apodizing: isApodizing(f.name),
    };
  });
}

/**
 * HQPlayer's apodization counter (manual §2.6, its filter table): an apodizing filter
 * suits a track whose counter passes 10. "suggest" when the filter in use isn't one
 * (or only partly), "handled" when it is, null below 10.
 */
export function apodization(apod: number, inUseApodizing: boolean | "partial" | undefined): "suggest" | "handled" | null {
  if (apod <= 10) return null;
  return inUseApodizing === true ? "handled" : "suggest";
}

/** The filter slot HQPlayer is using (1x below 50 kHz, manual §4.6), from the source, else from State; null when stopped. */
export function inUseSlot(snap: Snapshot): "1x" | "Nx" | null {
  if (snap.status.state === 0) return null;
  const sr = snap.status.source?.sampleRate;
  if (sr) return filterSlot(sr);
  return snap.state.filterInUse === snap.state.filter1x ? "1x" : "Nx";
}

export const ratioLabel = (c: Ctx) =>
  c.source && c.outRate ? `${formatRate(c.source, "PCM")} → ${formatRate(c.outRate, c.caps.mode.name)}` : "";

/** Output rates that fit `filter` from the current source, for the rate sheet. */
export function rateOptions(c: Ctx, filter: string) {
  const options = compatibleRates({
    filter,
    sourceRate: c.source,
    rates: c.caps.rates.filter((r) => r.allowed).map((r) => r.rate),
    sdm: c.isSdm,
    shaper: c.shaperName,
    currentRate: c.outRate,
    given: ratioOf(c, filter),
  }).map((o) => ({ label: formatRate(o.rate, c.caps.mode.name), rate: o.rate, nearest: o.nearest }));
  return { options, auto: c.caps.rates.some((r) => r.rate === 0 && r.allowed) && c.fixedRate };
}

/**
 * A queued track that can't start (guard 1). Measured (6.2.3): Play is accepted, nothing
 * happens, and Status shows plain idle. Fixing the rate doesn't start it by itself.
 */
export function wedge(c: Ctx) {
  const { snap } = c;
  if (snap.status.state === 2 || snap.status.source || !snap.queuedRate || !c.fixedRate) return null;
  const slot: Slot = filterSlot(snap.queuedRate) === "1x" ? "filter1x" : "filterNx";
  const filter = nameAt(c.caps.filters, snap.state[slot]);
  const r = ratioHint(filter, snap.queuedRate, c.outRate, c.isSdm, ratioOf(c, filter));
  if (r?.level === "hard") return { slot, filter, text: r.text, cause: "filter" as const };
  const m = c.isSdm ? modulatorHint(c.shaperName, c.outRate) : undefined;
  if (m?.level === "hard") return { slot, filter, text: m.text, cause: "modulator" as const };
  return null;
}

// The next album may be a different rate family. Typical source rates per slot.
const SOURCES = { filter1x: [44_100, 48_000], filterNx: [88_200, 96_000, 176_400, 192_000] } as const;

/** Other source rates the current filters can't play at a fixed output rate (guard 2). */
export function otherSourceNotes(c: Ctx): string[] {
  if (!c.fixedRate || !c.outRate) return [];
  return (["filter1x", "filterNx"] as const).flatMap((slot) => {
    const name = nameAt(c.caps.filters, c.snap.state[slot]);
    // The source playing or queued is covered by the picker and the banner; this is about the others.
    const bad = SOURCES[slot].filter(
      (src) => src !== c.source && ratioHint(name, src, c.outRate, c.isSdm, ratioOf(c, name))?.level === "hard",
    );
    return bad.length ? [`${name} won't play ${bad.map((b) => `${b / 1000}k`).join(", ")} sources`] : [];
  });
}

export function shaperItems(c: Ctx) {
  return c.caps.shapers.map((s) => ({
    ...decorate(
      s,
      c.isSdm ? modulatorHint(s.name, c.outRate) : ditherHint(s.name, c.outRate),
      warnFor(c, "shaper", s.name),
      c.isSdm ? MODULATOR_NOTE[s.name] : undefined,
    ),
    ...(c.isSdm && modulatorGen(s.name, s.description, c.shapersDescribed) !== undefined
      ? { gen: modulatorGen(s.name, s.description, c.shapersDescribed)! }
      : {}),
  }));
}

export function rateItems(c: Ctx) {
  const ratioClass = ratioOf(c, c.inUseFilter);
  return c.caps.rates.map((r) => {
    const ratio = r.rate && c.source ? ratioHint(c.inUseFilter, c.source, r.rate, c.isSdm, ratioClass) : undefined;
    const mod = r.rate ? (c.isSdm ? modulatorHint(c.shaperName, r.rate) : ditherHint(c.shaperName, r.rate)) : undefined;
    const rule = ratio?.level === "hard" ? ratio : mod;
    return {
      ...decorate(
        { index: r.index, name: formatRate(r.rate, c.caps.mode.name) },
        rule,
        r.rate ? warnFor(c, "rateHz", r.rate) : undefined,
        r.note,
      ),
      rate: r.rate,
      disabled: !r.allowed,
    };
  });
}
