// Dither advice from the setup answers, the PCM rate, and the shapers this instance lists.
// Two answers (review, 5 Oct 2026): a ladder DAC at the shaping rate and up gets noise
// shaping (NS5 or NS9 at 352.8/384k; LNS15, NS9 or NS5 from 705.6k, LNS15 being built for
// those rates); everything else gets TPDF or Gauss1 as equals. Never "none".
import type { Setup } from "../api.ts";
import { POLICY, RULES, type Rule } from "./policy.ts";

export interface DitherInput {
  setup: Setup;
  /** The PCM output rate the advice is for, in Hz. */
  rateHz: number;
  /** The dithers / noise shapers HQPlayer lists in PCM mode, by name. */
  shapers: string[];
}

export interface DitherAdvice {
  /** needs-rate: a ladder DAC's advice depends on the rate, and it isn't known (auto, stopped). */
  status: "needs-dac" | "needs-rate" | "ok";
  /** The group to choose from, as equals, in the order to try; `start` is the first listed. */
  group: string[];
  start: string | null;
  rules: Rule[];
  /** What to set DAC Bits to, in HQPlayer's own settings (hqpweb can't read or set it). */
  bits: { kind: "ladder" | "default" | "24" | "match"; rule: Rule | null } | null;
  /** The rate is too low for a ladder DAC: raise it if the DAC allows. */
  raiseRate: boolean;
  /** The DAC takes DSD well, so DSD output usually beats PCM: the rule that says so, else null. */
  tryDsd: Rule | null;
}

export function ditherAdvice(input: DitherInput): DitherAdvice {
  const { setup, rateHz, shapers } = input;
  const listed = (names: string[]) => names.filter((n) => shapers.includes(n));
  const takesDsd = setup.dsd === "older-ess" || setup.dsd === "remodulates" || setup.dsd === "direct";
  const tryDsd =
    setup.pcm === "delta-sigma" && takesDsd
      ? RULES.dsdBetter
      : setup.pcm === "ladder" && setup.dsd === "direct"
        ? RULES.holoDsd
        : null;
  if (!setup.pcm) return { status: "needs-dac", group: [], start: null, rules: [], bits: null, raiseRate: false, tryDsd: null };

  const ladder = setup.pcm === "ladder";
  const bits: DitherAdvice["bits"] = ladder
    ? { kind: "ladder", rule: RULES.ladderBits }
    : setup.link === "spdif"
      ? { kind: "24", rule: null }
      : setup.link === "i2s"
        ? { kind: "match", rule: RULES.i2sBits }
        : { kind: "default", rule: null };

  if (ladder && rateHz <= 0) return { status: "needs-rate", group: [], start: null, rules: [], bits, raiseRate: false, tryDsd };
  if (ladder && setup.link !== "spdif" && rateHz >= POLICY.ladderShapingFromHz) {
    const high = rateHz >= POLICY.lns15FromHz;
    const group = listed(high ? ["LNS15", "NS9", "NS5"] : ["NS5", "NS9"]);
    const rules = [high ? RULES.ladderShapers : RULES.ladderAt384];
    return { status: "ok", group, start: group[0] ?? null, rules, bits, raiseRate: false, tryDsd };
  }
  const group = listed(["TPDF", "Gauss1"]);
  // Not over S/PDIF: it tops out around 192k, so there's no higher rate to go to.
  const raiseRate = ladder && setup.link !== "spdif" && rateHz < POLICY.ladderShapingFromHz;
  return {
    status: "ok",
    group,
    start: group[0] ?? null,
    rules: [raiseRate ? RULES.ladderRate : RULES.flatDither],
    bits,
    raiseRate,
    tryDsd,
  };
}

/** Shapers to show only on request: older or specialised, rarely suggested. */
export const MORE_SHAPERS = ["NS4", "shaped", "NS1", "RPDF"];
/** Never for listening. */
export const NEVER = "none";
