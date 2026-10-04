// Compatibility rules, restated in our own words from the HQPlayer Desktop user
// manual (v5.13, sections cited per rule; the manual itself is not reproduced
// here) plus what we measured. "hard" = predicted not to play; "soft" = works
// but outside the recommended range. The app warns; it never blocks.
//
// Unknown names get no prediction: the engine (5.32+) has filters the 5.13
// manual doesn't list, and guessing would be worse than silence.

import { FILTERS_V6, MODULATOR_GEN, MODULATOR_NOTE } from "./fallback.ts";

/**
 * Which conversion ratios a filter can do: from the manual's §4.6 "Ratio" column,
 * and from HQPlayer 6's own filter descriptions where they differ (those win).
 */
export type RatioClass = "any" | "any-up" | "integer" | "integer-up" | "pow2" | "pow2-up" | "1:1";

const RATIO: Record<string, RatioClass> = {
  none: "1:1",
  IIR: "integer",
  IIR2: "integer",
  FIR: "integer",
  asymFIR: "integer",
  minphaseFIR: "integer",
  FFT: "pow2", // §4.6: "2^x" (either direction), as HQPlayer 6 also says
  "poly-sinc-lp": "any",
  "poly-sinc-mp": "any",
  "poly-sinc-short-lp": "any",
  "poly-sinc-short-mp": "any",
  "poly-sinc-long-lp": "any",
  "poly-sinc-long-ip": "any",
  "poly-sinc-long-mp": "any",
  "poly-sinc-hb": "any",
  "poly-sinc-hb-xs": "any",
  "poly-sinc-hb-s": "any",
  "poly-sinc-hb-m": "any",
  "poly-sinc-hb-l": "any",
  "poly-sinc-ext": "integer",
  "poly-sinc-ext2": "any",
  // Not in the 5.13 manual; from HQPlayer 6's descriptions (same names in v5.17).
  "poly-sinc-ext2-short": "integer-up",
  "poly-sinc-ext2-medium": "any",
  "poly-sinc-ext2-long": "any",
  "poly-sinc-ext2-xla": "any",
  "poly-sinc-ext2-xl": "any",
  "poly-sinc-ext2-hires-lp": "any",
  "poly-sinc-ext2-hires-ip": "any",
  "poly-sinc-ext2-hires-mp": "any",
  "poly-sinc-gauss-medium": "any",
  "poly-sinc-ext3": "any",
  // PCM: integer up; SDM: any (§4.6).
  "poly-sinc-mqa/mp3-lp": "integer-up",
  "poly-sinc-mqa/mp3-mp": "integer-up",
  "poly-sinc-xtr-lp": "any",
  "poly-sinc-xtr-mp": "any",
  "poly-sinc-xtr-short-lp": "any",
  "poly-sinc-xtr-short-mp": "any",
  "poly-sinc-gauss-short": "integer-up",
  "poly-sinc-gauss": "any",
  "poly-sinc-gauss-long": "any",
  "poly-sinc-gauss-xl": "any",
  "poly-sinc-gauss-xla": "any",
  "poly-sinc-gauss-hires-lp": "any",
  "poly-sinc-gauss-hires-ip": "any",
  "poly-sinc-gauss-hires-mp": "any",
  "poly-sinc-gauss-halfband": "any",
  "poly-sinc-gauss-halfband-s": "any",
  ASRC: "any",
  "polynomial-1": "integer-up",
  "polynomial-2": "integer-up",
  "minringFIR-lp": "integer-up",
  "minringFIR-mp": "integer-up",
  "closed-form": "pow2-up",
  "closed-form-fast": "pow2-up",
  "closed-form-M": "pow2-up",
  "closed-form-16M": "pow2-up",
  // The v5.13 manual says whole-number; measured on Desktop 5.17.2 (PCM), sinc-M
  // refuses 3× and plays 2× down, so power-of-two either way. Measured for sinc-M,
  // inferred for the family. HQPlayer 6 says "2^x up" in PCM; v6 instances use that.
  "sinc-S": "pow2",
  "sinc-M": "pow2",
  "sinc-Mx": "pow2",
  "sinc-MG": "pow2",
  "sinc-MGa": "pow2",
  "sinc-L": "pow2",
  "sinc-Ls": "pow2",
  "sinc-Lm": "pow2",
  "sinc-Ll": "pow2",
  "sinc-Lh": "pow2",
  "sinc-short": "any",
  "sinc-medium": "any",
  "sinc-long": "any",
  "sinc-long-h": "any",
};

/**
 * Apodizing filters, from HQPlayer 6's own filter table (the "Apodizing" column of
 * Embedded 6.2.3's settings page): yes, no, or "½", partly. Names only. It's newer
 * than the v5.13 manual and refines it (e.g. poly-sinc-lp is ½ there, plain X in
 * 5.13), so it's used for v5 too. "-2s" variants follow their base filter.
 */
const APODIZING: Record<string, Apodizing> = {
  none: false,
  IIR: true,
  IIR2: true,
  FIR: true,
  asymFIR: true,
  minphaseFIR: true,
  FFT: true,
  "poly-sinc-lp": "partial",
  "poly-sinc-mp": "partial",
  "poly-sinc-short-lp": "partial",
  "poly-sinc-short-mp": "partial",
  "poly-sinc-long-lp": true,
  "poly-sinc-long-ip": true,
  "poly-sinc-long-mp": true,
  "poly-sinc-hb": false,
  "poly-sinc-hb-xs": false,
  "poly-sinc-hb-s": false,
  "poly-sinc-hb-m": false,
  "poly-sinc-hb-l": false,
  "poly-sinc-ext": "partial",
  "poly-sinc-ext2": true,
  "poly-sinc-ext2-short": "partial",
  "poly-sinc-ext2-medium": true,
  "poly-sinc-ext2-long": true,
  "poly-sinc-ext2-xla": true,
  "poly-sinc-ext2-xl": false,
  "poly-sinc-ext2-hires-lp": true,
  "poly-sinc-ext2-hires-ip": true,
  "poly-sinc-ext2-hires-mp": true,
  "poly-sinc-mqa/mp3-lp": true,
  "poly-sinc-mqa/mp3-mp": true,
  "poly-sinc-xtr-lp": "partial",
  "poly-sinc-xtr-mp": "partial",
  "poly-sinc-xtr-short-lp": true,
  "poly-sinc-xtr-short-mp": true,
  "poly-sinc-gauss-short": "partial",
  "poly-sinc-gauss-medium": true,
  "poly-sinc-gauss-long": true,
  "poly-sinc-gauss-xla": true,
  "poly-sinc-gauss-xl": false,
  "poly-sinc-gauss-hires-lp": true,
  "poly-sinc-gauss-hires-ip": true,
  "poly-sinc-gauss-hires-mp": true,
  "poly-sinc-gauss-halfband": false,
  "poly-sinc-gauss-halfband-s": false,
  ASRC: false,
  "polynomial-1": false,
  "polynomial-2": false,
  "minringFIR-lp": false,
  "minringFIR-mp": false,
  "closed-form": false,
  "closed-form-fast": false,
  "closed-form-M": false,
  "sinc-S": true,
  "sinc-M": true,
  "sinc-Mx": true,
  "sinc-MG": false,
  "sinc-MGa": true,
  "sinc-L": false,
  "sinc-Ls": false,
  "sinc-Lm": false,
  "sinc-Ll": false,
  "sinc-Lh": false,
  "sinc-short": false,
  "sinc-medium": false,
  "sinc-long": false,
  "sinc-long-h": false,
};
export type Apodizing = boolean | "partial";
/** Whether a filter is apodizing; undefined when HQPlayer's table doesn't list it. */
export function isApodizing(filter: string): Apodizing | undefined {
  const base = filter.endsWith("-2s") ? filter.slice(0, -3) : filter;
  return APODIZING[base];
}

/** Ratio class for a filter name; "-2s" variants share their base filter's (§4.6). */
export function ratioClass(filter: string): RatioClass | undefined {
  return RATIO[filter] ?? (filter.endsWith("-2s") ? RATIO[filter.slice(0, -3)] : undefined);
}

/** §4.6: the 1x filter covers source rates below 50 kHz; Nx everything above. */
export const filterSlot = (sourceRate: number): "1x" | "Nx" => (sourceRate < 50_000 ? "1x" : "Nx");

export interface Hint {
  level: "hard" | "soft";
  text: string;
}

const khz = (hz: number) => (hz >= 1_000_000 ? `${+(hz / 1_000_000).toFixed(4)} MHz` : `${+(hz / 1000).toFixed(1)}k`);
const isPow2 = (n: number) => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;

/** Can `filter` convert `sourceRate` to `outputRate`? Undefined when unknown. */
export function ratioHint(
  filter: string,
  sourceRate: number,
  outputRate: number,
  sdm = false,
  /** HQPlayer's own class for this filter (from its description), when it gives one. */
  given?: RatioClass,
): Hint | undefined {
  const cls = given ?? ratioClass(filter);
  if (!cls || !sourceRate || !outputRate) return undefined;
  const r = outputRate / sourceRate;
  const ratio = Number.isInteger(r) ? `${r}×` : `${r.toFixed(2)}×`;
  const why = (need: string) => ({
    level: "hard" as const,
    text: `${filter} needs ${need}; ${khz(sourceRate)} → ${khz(outputRate)} is ${ratio}`,
  });
  switch (cls) {
    case "any":
      return undefined;
    case "any-up":
      return r >= 1 ? undefined : why("upsampling (it can't convert down)");
    case "1:1":
      return r === 1 ? undefined : why("the output rate to equal the source rate");
    case "integer":
      return Number.isInteger(r) || Number.isInteger(1 / r) ? undefined : why("a whole-number ratio");
    case "integer-up":
      if (sdm && filter.startsWith("poly-sinc-mqa")) return undefined; // any ratio for SDM (§4.6)
      return Number.isInteger(r) && r >= 1 ? undefined : why("a whole-number upsampling ratio");
    case "pow2":
      return isPow2(r) || isPow2(1 / r) ? undefined : why("a power-of-two ratio");
    case "pow2-up":
      return isPow2(r) ? undefined : why("a power-of-two upsampling ratio");
  }
}

/**
 * Modulator rate floors (§4.5). AHM* 5L/8B are "optimized for ≥ 40.96 MHz"; we
 * measured AHM7EC8B stopping at DSD256 and DSD512, so treat the AHM family as
 * hard (measured for one member, inferred for the rest). The others are soft.
 */
export function modulatorHint(shaper: string, outputRate: number): Hint | undefined {
  if (!outputRate) return undefined;
  if (/^AHM/.test(shaper) && outputRate < 40_960_000)
    return { level: "hard", text: `${shaper} needs ≥ 40.96 MHz (DSD1024); ${khz(outputRate)} stops playback` };
  if (/^AMSDM/.test(shaper) && outputRate < 20_480_000)
    return { level: "soft", text: `${shaper} is designed for ≥ 20.48 MHz (DSD512)` };
  if (/512\+fs$/.test(shaper) && outputRate < 22_579_200)
    return { level: "soft", text: `${shaper} is optimised for DSD512 and up` };
  if (/256\+fs$/.test(shaper) && outputRate < 10_240_000)
    return { level: "soft", text: `${shaper} is optimised for ≥ 10.24 MHz (DSD256)` };
  return undefined;
}

/** PCM dither / noise-shaping recommendations by output rate (§4.4). All soft. */
export function ditherHint(dither: string, outputRate: number): Hint | undefined {
  if (!outputRate) return undefined;
  const soft = (text: string): Hint => ({ level: "soft", text });
  switch (dither) {
    case "none":
      return soft("rounding only; not recommended except for bit-perfect tests");
    case "NS1":
      return outputRate < 176_400 || outputRate > 192_000 ? soft("NS1 is intended mostly for 176.4/192k") : undefined;
    case "NS4":
    case "shaped":
      return outputRate < 88_200 ? soft(`${dither} is for 88.2k and up`) : undefined;
    case "NS5":
      return outputRate < 192_000 ? soft("NS5 isn't recommended below 192k") : undefined;
    case "NS9":
      return outputRate < 176_400 || outputRate > 192_000 ? soft("NS9 is designed for 176.4/192k") : undefined;
    case "LNS15":
      return outputRate < 352_800 ? soft("LNS15 isn't recommended below 352.8k") : undefined;
    case "Gauss1":
      return outputRate > 96_000 ? soft("Gauss1 is recommended at 96k and below") : undefined;
    default:
      return undefined;
  }
}

/** §2.15: keep volume at or below −3 dBFS when resampling or in SDM. */
export const RECOMMENDED_MAX_VOLUME_DB = -3;

/** Would this combination be expected to stop? Used to avoid "learning" rule-explained failures. */
export function predictedStop(c: {
  mode: string;
  filter: string;
  shaper: string;
  sourceRate: number;
  outputRate: number;
  /** HQPlayer 6's description of the filter, if it gave one: its ratio rule wins. */
  filterDescription?: string;
}): Hint | undefined {
  const sdm = c.mode.startsWith("SDM");
  const r = ratioHint(c.filter, c.sourceRate, c.outputRate, sdm, parseFilterDescription(c.filterDescription)?.ratio);
  if (r?.level === "hard") return r;
  const m = sdm ? modulatorHint(c.shaper, c.outputRate) : undefined;
  return m?.level === "hard" ? m : undefined;
}

/**
 * Output rates a filter can play from `sourceRate`: its ratio rule, and in SDM the
 * modulator's hard floor. `nearest` marks the one closest to `currentRate` (by
 * ratio), the least surprising switch.
 */
export function compatibleRates(c: {
  filter: string;
  sourceRate: number;
  rates: number[];
  sdm: boolean;
  shaper: string;
  currentRate: number;
  /** HQPlayer's own ratio class for the filter, when it gives one. */
  given?: RatioClass;
}): { rate: number; nearest: boolean }[] {
  const fits = c.rates.filter(
    (hz) =>
      hz > 0 &&
      ratioHint(c.filter, c.sourceRate, hz, c.sdm, c.given)?.level !== "hard" &&
      (!c.sdm || modulatorHint(c.shaper, hz)?.level !== "hard"),
  );
  const dist = (hz: number) => Math.abs(Math.log(hz / (c.currentRate || c.sourceRate)));
  const best = fits.reduce<number | undefined>((b, hz) => (b === undefined || dist(hz) < dist(b) ? hz : b), undefined);
  return fits.map((rate) => ({ rate, nearest: rate === best }));
}

/**
 * HQPlayer 6's filter description, e.g. "5/5 transients, timbre ⥮ Any up":
 * a rating out of 5, what the filter favours, and its ratio rule. Measured on
 * engine 6.2.3: all 84 filters follow this shape. The arrow was ⥣ for every SDM
 * filter and ⥮ for every PCM one in our capture; its meaning isn't documented, so
 * it's kept raw.
 */
export interface FilterInfo {
  rating: number;
  tags: string[];
  ratio?: RatioClass;
  /** The ratio rule as HQPlayer words it, e.g. "2^x up". */
  ratioText: string;
  arrow: string;
}

const RATIO_TEXT: Record<string, RatioClass> = {
  Any: "any",
  "Any up": "any-up",
  Int: "integer",
  "Int up": "integer-up",
  "2^x": "pow2",
  "2^x up": "pow2-up",
  "1:1": "1:1",
};

export function parseFilterDescription(d: string | undefined): FilterInfo | undefined {
  // Real descriptions are ~40 characters. The tags are "anything but the arrow",
  // so no two parts of the pattern compete for the same text (no backtracking blow-up).
  const m = d && d.length <= 200 ? /^(\d)\/5([^⥣⥮]*)([⥣⥮]) *(Any|Int|2\^x|1:1)( +up)? *$/u.exec(d.trim()) : null;
  if (!m) return undefined;
  const ratioText = `${m[4]}${m[5] ? " up" : ""}`;
  const ratio = RATIO_TEXT[ratioText];
  return {
    rating: Number(m[1]),
    tags: m[2]!
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    ...(ratio ? { ratio } : {}),
    ratioText,
    arrow: m[3]!,
  };
}

/** HQPlayer 6's modulator description, "Gen8" → 8. */
export const modulatorGeneration = (d: string | undefined): number | undefined => {
  const m = d ? /^Gen(\d+)$/.exec(d) : null;
  return m ? Number(m[1]) : undefined;
};

const RATIO_WORDING = Object.fromEntries(Object.entries(RATIO_TEXT).map(([text, cls]) => [cls, text])) as Record<
  RatioClass,
  string
>;

/** What the pickers show about a filter. `fromHqp`: HQPlayer itself said so. */
export interface FilterNotes {
  rating?: number;
  tags: string[];
  ratio?: RatioClass;
  ratioText?: string;
  fromHqp: boolean;
}

/**
 * HQPlayer 6 describes its own filters. v5 doesn't, so for a v5 instance
 * (`described` false) use HQPlayer 6's rating and focus for the same name, and
 * the v5 manual's ratio rule from our table.
 */
export function filterNotes(
  name: string,
  description: string | undefined,
  sdm: boolean,
  described: boolean,
): FilterNotes | undefined {
  const info = parseFilterDescription(description);
  if (info) return { rating: info.rating, tags: info.tags, ratio: info.ratio, ratioText: info.ratioText, fromHqp: true };
  if (described) return undefined;
  const mirror = FILTERS_V6[sdm ? "sdm" : "pcm"][name];
  let ratio = ratioClass(name);
  if (sdm && ratio === "integer-up" && name.startsWith("poly-sinc-mqa")) ratio = "any"; // §4.6
  if (!mirror && !ratio) return undefined;
  return {
    ...(mirror?.[0] ? { rating: mirror[0] } : {}),
    tags: mirror?.[1] ?? [],
    ...(ratio ? { ratio, ratioText: RATIO_WORDING[ratio] } : {}),
    fromHqp: false,
  };
}

/** Modulator generation: HQPlayer's own, else HQPlayer 6's for the same name (v5). */
export const modulatorGen = (name: string, description: string | undefined, described: boolean): number | undefined =>
  modulatorGeneration(description) ?? (described ? undefined : MODULATOR_GEN[name]);

export { MODULATOR_NOTE };
