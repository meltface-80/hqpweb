// Modulator advice from the setup answers, the rate, and the modulators this instance
// actually lists. Reads its rules and numbers from policy.ts. Names are always resolved
// against the instance's own list (CLAUDE.md rule 5), never assumed.
import type { Setup } from "../api.ts";
import { POLICY, RULES, type Rule } from "./policy.ts";

export interface ModulatorInput {
  setup: Setup;
  /** The output rate the advice is for, in Hz (HQPlayer's, or one the listener is planning for). */
  rateHz: number;
  /** The modulators HQPlayer lists in SDM mode, by name. */
  modulators: string[];
  /** HQPlayer's processing speed now (Status), when playing; null when unknown. */
  processSpeed?: number | null;
}

export type Variant = (typeof POLICY.variants)[number];

export interface ModulatorAdvice {
  /** needs-dac: the DSD question isn't answered. use-pcm: the DAC converts DSD. */
  status: "needs-dac" | "use-pcm" | "ok";
  order: 5 | 7;
  /**
   * The DSD rate that suits the DAC, if any. Direct DACs: DSD1024 with AHM is also fine, and
   * DSD512 too with a class-D or tube amp. `rules` cite each part, and any exception.
   */
  suggestedRate: { label: "DSD256" | "DSD512"; orDsd1024: boolean; orDsd512: boolean; rules: Rule[] } | null;
  /** Where to start, and the rules that moved it off HQPlayer's default. Null when nothing fits. */
  start: { name: string; isDefault: boolean; rules: Rule[] } | null;
  /**
   * Others to compare by ear: the rest of the EC family, lightest first (the plain version
   * first when the start is 512+fs, an option rather than an upgrade); at DSD1024, the
   * other AHM versions instead, since the EC line doesn't suit that rate.
   */
  alternatives: { name: string }[];
  /** Whether the 512+fs versions are on offer at this rate, and whether they're suggested. */
  p512: { offered: boolean; suggested: boolean };
  /** Modulators this instance lists that the advice doesn't know: newer than our rules. */
  unknown: string[];
  machine: { state: "keeps-up" | "tight" | "behind"; rule: Rule } | null;
  /** False when the rate is unknown (auto, stopped): AHM and 512+fs can't be judged. */
  rateKnown: boolean;
}

const is = <T extends string>(list: readonly T[], v: string | undefined): boolean =>
  v !== undefined && (list as readonly string[]).includes(v);

/** Names the rules know: the EC line, AHM, AMSDM, and the older series. */
const KNOWN =
  /^(DSD[57](v2)?( 256\+fs)?|DSD5EC|ASDM[57](EC(v[23])?)?|ASDM[57]EC-(ul|light|fast|super)( 512\+fs)?|AMSDM7(EC)? 512\+fs|AHM[57]EC(5L|8B|4B))$/;

export function modulatorAdvice(input: ModulatorInput): ModulatorAdvice {
  const { setup, rateHz, modulators } = input;
  const has = (n: string) => modulators.includes(n);
  const order: 5 | 7 = is(POLICY.fifthOrderFor.dsd, setup.dsd) || is(POLICY.fifthOrderFor.amp, setup.amp) ? 5 : 7;
  const unknown = modulators.filter((n) => !KNOWN.test(n));
  const machine = machineState(input.processSpeed ?? null);
  const empty = {
    order,
    suggestedRate: null,
    start: null,
    alternatives: [],
    p512: { offered: false, suggested: false },
    unknown,
    machine,
    rateKnown: rateHz > 0,
  };
  if (!setup.dsd) return { status: "needs-dac", ...empty };

  const rate = POLICY.rateFor[setup.dsd];
  const direct = setup.dsd === "direct";
  const ampRate = direct && is(POLICY.fifthOrderFor.amp, setup.amp);
  const rateRules = direct
    ? [RULES.rateDirect, ...(ampRate ? [RULES.ampRate] : [])]
    : [RULES.rateEss, ...(setup.dsd === "remodulates" ? [RULES.akmPairRate] : [])];
  const suggestedRate = rate ? { label: rate, orDsd1024: direct, orDsd512: ampRate, rules: rateRules } : null;
  // A DAC that converts DSD: PCM suits it better, but anyone staying in DSD still gets a
  // starting point (informing, not refusing).

  const rules: Rule[] = [];
  if (setup.dsd === "older-ess") rules.push(RULES.olderEssFifth);
  if (is(POLICY.fifthOrderFor.amp, setup.amp)) rules.push(RULES.ampFifth);

  const p512Offered = rateHz >= POLICY.p512FromHz;
  const p512Suggested = p512Offered && setup.volume === "hqplayer";
  const base = `ASDM${order}EC`;
  const ec = (v: Variant, p512: boolean) => `${base}-${v}${p512 ? " 512+fs" : ""}`;
  // The EC family at this rate, in its regular versions. 512+fs is offered, never the start:
  // HQPlayer's volume as the main control isn't a setup to steer people to (RULES.gainOpt).
  const p512Option = p512Suggested ? [ec(POLICY.defaultVariant, true)].filter(has) : [];
  const family = POLICY.variants.map((v) => ec(v, false)).filter(has);

  let start: ModulatorAdvice["start"] = null;
  if (rateHz >= POLICY.ahmFromHz) {
    const ahm = POLICY.ahmPreference.map((s) => `AHM${order}${s}`).find(has);
    if (ahm) {
      const r = [RULES.dsd1024Ahm, ...(ahm.endsWith("EC4B") ? [RULES.ahm4b] : []), ...rules];
      start = { name: ahm, isDefault: false, rules: r };
    }
  }
  if (!start) {
    const name = ec(POLICY.defaultVariant, false);
    if (has(name)) {
      const isDefault = name === `ASDM7EC-${POLICY.defaultVariant}`;
      start = { name, isDefault, rules: isDefault ? [RULES.default] : rules };
    }
  }
  let alternatives: ModulatorAdvice["alternatives"];
  if (start && modulatorIsAhm(start.name)) {
    const other = order === 5 ? 7 : 5;
    const ahm = [order, other].flatMap((o) => POLICY.ahmPreference.map((s) => `AHM${o}${s}`));
    alternatives = ahm.filter((n) => n !== start?.name && has(n)).map((name) => ({ name }));
  } else {
    alternatives = [...p512Option, ...family.filter((n) => n !== start?.name)].map((name) => ({ name }));
  }
  return {
    status: setup.dsd === "converts" ? "use-pcm" : "ok",
    order,
    suggestedRate,
    start,
    alternatives,
    p512: { offered: p512Offered, suggested: p512Suggested },
    unknown,
    machine,
    rateKnown: rateHz > 0,
  };
}

const modulatorIsAhm = (name: string) => name.startsWith("AHM");

function machineState(speed: number | null): ModulatorAdvice["machine"] {
  if (speed === null || !Number.isFinite(speed) || speed <= 0) return null;
  const state = speed < POLICY.speed.behind ? "behind" : speed < POLICY.speed.tight ? "tight" : "keeps-up";
  return { state, rule: RULES.speed };
}
