// Compatibility rules, restated in our own words from the HQPlayer Desktop user
// manual (v5.13, sections cited per rule; the manual itself is not reproduced
// here) plus what we measured. "hard" = predicted not to play; "soft" = works
// but outside the recommended range. The app warns; it never blocks.
//
// Unknown names get no prediction: the engine (5.32+) has filters the 5.13
// manual doesn't list, and guessing would be worse than silence.

/** §4.6 "Ratio" column: which conversion ratios a filter can do. */
export type RatioClass = "any" | "integer" | "integer-up" | "pow2-up" | "1:1";

const RATIO: Record<string, RatioClass> = {
  none: "1:1",
  IIR: "integer",
  IIR2: "integer",
  FIR: "integer",
  asymFIR: "integer",
  minphaseFIR: "integer",
  FFT: "pow2-up",
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
  "sinc-S": "integer",
  "sinc-M": "integer",
  "sinc-Mx": "integer",
  "sinc-MG": "integer",
  "sinc-MGa": "integer",
  "sinc-L": "integer",
  "sinc-Ls": "integer",
  "sinc-Lm": "integer",
  "sinc-Ll": "integer",
  "sinc-Lh": "integer",
  "sinc-short": "any",
  "sinc-medium": "any",
  "sinc-long": "any",
  "sinc-long-h": "any",
};

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
export function ratioHint(filter: string, sourceRate: number, outputRate: number, sdm = false): Hint | undefined {
  const cls = ratioClass(filter);
  if (!cls || !sourceRate || !outputRate) return undefined;
  const r = outputRate / sourceRate;
  const ratio = Number.isInteger(r) ? `${r}×` : `${r.toFixed(2)}×`;
  const why = (need: string) => ({ level: "hard" as const, text: `${filter} needs ${need}; ${khz(sourceRate)} → ${khz(outputRate)} is ${ratio}` });
  switch (cls) {
    case "any":
      return undefined;
    case "1:1":
      return r === 1 ? undefined : why("the output rate to equal the source rate");
    case "integer":
      return Number.isInteger(r) || Number.isInteger(1 / r) ? undefined : why("a whole-number ratio");
    case "integer-up":
      if (sdm && filter.startsWith("poly-sinc-mqa")) return undefined; // any ratio for SDM (§4.6)
      return Number.isInteger(r) && r >= 1 ? undefined : why("a whole-number upsampling ratio");
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
export function predictedStop(c: { mode: string; filter: string; shaper: string; sourceRate: number; outputRate: number }): Hint | undefined {
  const sdm = c.mode.startsWith("SDM");
  const r = ratioHint(c.filter, c.sourceRate, c.outputRate, sdm);
  if (r?.level === "hard") return r;
  const m = sdm ? modulatorHint(c.shaper, c.outputRate) : undefined;
  return m?.level === "hard" ? m : undefined;
}
