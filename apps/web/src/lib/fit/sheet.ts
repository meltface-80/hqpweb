// The filter sheet's view of fit.ts: which filters fit as set, why the others don't, the
// "Try anyway?" question, and "What would it take?" suggestions in words. Pure; the sheet
// (FilterSheet.svelte, FitPanel.svelte) only shows it.
import { filterSlot } from "@app/protocol/compat";
import { formatRate, type Change, type Combo, type Failure, type KeptUp } from "../api.ts";
import { failedText, ratioOf, type Ctx } from "../hints.ts";
import { fit, nearestFits, slotOf, type Fit, type FitInput, type Options, type Pin, type Suggestion } from "./fit.ts";
import { AGE_STOPS, DEFAULT_MAX_AGE_DAYS, runOf, type MaxAgeDays } from "./evidence.ts";
import type { Step } from "./order.ts";

export interface SheetFit {
  input: FitInput;
  options: Options;
  failures: Failure[];
  kept: KeptUp[];
}

/**
 * What the sheet for `slot` needs, or null when its filter doesn't decide this playback
 * (nothing queued, or the source uses the other slot): then the list isn't split.
 */
export function sheetFit(c: Ctx, slot: "1x" | "Nx", maxAgeDays: number | null = DEFAULT_MAX_AGE_DAYS): SheetFit | null {
  if (!c.source || filterSlot(c.source) !== slot || !c.outRate) return null;
  return {
    input: {
      combo: { ...c.combo, rateHz: c.outRate },
      sourceRate: c.source,
      sdm: c.isSdm,
      ratioOf: (n) => ratioOf(c, n),
      ratioFixed: c.fixedRate,
      maxAgeDays,
    },
    options: {
      filters: c.caps.filters.map((f) => f.name),
      shapers: c.caps.shapers.map((s) => s.name),
      // Some modes can't set the rate (server change-engine.ts): don't suggest one there.
      rates: c.caps.rateSettable ? c.caps.rates.filter((r) => r.allowed && r.rate > 0).map((r) => r.rate) : [],
    },
    failures: c.caps.knownBad,
    kept: c.caps.keptUp,
  };
}

const withFilter = (s: SheetFit, name: string): FitInput => ({
  ...s.input,
  combo: { ...s.input.combo, [slotOf(s.input.sourceRate)]: name },
});

export const filterFit = (s: SheetFit, name: string): Fit => fit(withFilter(s, name), s.failures, s.kept);

/** Below the line: a hard rule, a failure here, or trouble inferred from one. */
export const fitsAsSet = (f: Fit) => f.verdict === "fits" || f.verdict === "try";

/** What differs in `run` from `target`, as a noun: "sinc-Lh", "the same settings at DSD512". */
function differs(run: ReturnType<typeof runOf>, target: ReturnType<typeof runOf>): string {
  const names = [run.filter !== target.filter ? run.filter : "", run.shaper !== target.shaper ? run.shaper : ""].filter(Boolean);
  const rate = run.rateHz !== target.rateHz ? ` at ${formatRate(run.rateHz)}` : "";
  return (names.join(" with ") || "the same settings") + rate;
}

const because = (steps: Step[]) => {
  const said = steps.filter((s) => s.basis.cites.length).map((s) => s.basis.says);
  return said.length ? ` (${said.join("; ")}${steps.some((s) => s.basis.inferred) ? ", inferred" : ""})` : "";
};

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why a filter is below the line, in one sentence; null when it fits as set. */
export function whyNot(s: SheetFit, name: string, f: Fit): string | null {
  if (fitsAsSet(f)) return null;
  const hard = f.rules.find((r) => r.level === "hard");
  if (hard) return `${hard.text}.`; // starts with the filter's name, as HQPlayer writes it
  const target = runOf(withFilter(s, name).combo, s.input.sourceRate);
  const l = f.load;
  switch (l.kind) {
    case "failed":
      return `${sentence(failedText(l.failure))}.`;
    case "slow":
      return `Ran ${l.kept.low.toFixed(2)}× here: slower than real time.`;
    case "likely-fails": {
      const what = differs(runOf(l.because, "sourceRate" in l.because ? l.because.sourceRate : s.input.sourceRate), target);
      return `Probably won't keep up here: ${what} couldn't, and this is no lighter${because(l.steps)}.`;
    }
    case "mixed":
      return "Mixed results here: something lighter failed, something heavier kept up.";
    case "kept":
    case "likely-keeps":
    case "none":
      return null;
  }
}

/**
 * The record behind a filter's trouble, for "Forget this": its own failure or slow run, or
 * the one the trouble is inferred from. null when there's nothing learned to forget.
 */
export function forgettable(f: Fit): Combo | null {
  const l = f.load;
  const pick = (x: Combo): Combo => ({
    mode: x.mode,
    rateHz: x.rateHz,
    filter1x: x.filter1x,
    filterNx: x.filterNx,
    shaper: x.shaper,
  });
  if (f.rules.some((r) => r.level === "hard")) return null;
  if (l.kind === "failed") return pick(l.failure);
  if (l.kind === "slow") return pick(l.kept);
  if (l.kind === "likely-fails") return pick(l.because);
  if (l.kind === "mixed") return pick(l.failed);
  return null;
}

const AGE_WORDS: Record<string, string> = { 7: "a week", 30: "a month", 90: "3 months", 180: "6 months", 365: "a year" };

/** The age setting's sentence: "Forget load results older than 3 months", or "Never forget…". */
export const ageSentence = (days: number | null) =>
  days === null ? "Never forget load results" : `Forget load results older than ${AGE_WORDS[days] ?? `${days} days`}`;

/** The slider's stop for a setting (an unknown value sits at the default's). */
export const ageStop = (days: number | null) => {
  const i = AGE_STOPS.indexOf(days as MaxAgeDays);
  return i >= 0 ? i : AGE_STOPS.indexOf(DEFAULT_MAX_AGE_DAYS);
};

/** The one question before picking a filter that's below the line (not for a ratio it can't do). */
export const tryAnyway = (why: string) => `${why} It may stall HQPlayer; hqpweb tries to roll back. Try anyway?`;

/** "DSD128 instead of DSD256 · ASDM7EC-fast instead of ASDM7EC-super". */
export function suggestionLabel(sg: Suggestion, from: Combo): string {
  const c = sg.change;
  return [
    c.rateHz !== undefined ? `${formatRate(c.rateHz)} instead of ${formatRate(from.rateHz)}` : "",
    c.shaper !== undefined ? `${c.shaper} instead of ${from.shaper}` : "",
    c.filter !== undefined ? `${c.filter}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** How sure: measured, inferred, or untried. */
export function suggestionStatus(sg: Suggestion): string {
  const l = sg.fit.load;
  if (l.kind === "kept") return `kept up here (${l.kept.low.toFixed(1)}×)`;
  if (l.kind === "likely-keeps") return "something no lighter kept up here";
  return sg.lighter ? "untried; lighter" : "untried";
}

/** What would it take to play `name`: suggestions with the filter pinned, plus any pins chosen. */
export function whatItTakes(s: SheetFit, name: string, keep: { shaper: boolean; rate: boolean }, max = 3): Suggestion[] {
  const pins = new Set<Pin>(["filter"]);
  if (keep.shaper) pins.add("shaper");
  if (keep.rate) pins.add("rateHz");
  return nearestFits(withFilter(s, name), pins, s.options, s.failures, s.kept, max);
}

/** The change to apply for a suggestion: the filter in its slot, and whatever else it moves. */
export function suggestionChange(s: SheetFit, name: string, sg: Suggestion): Change {
  return {
    [slotOf(s.input.sourceRate)]: name,
    ...(sg.change.shaper !== undefined ? { shaper: sg.change.shaper } : {}),
    ...(sg.change.rateHz !== undefined ? { rate: sg.change.rateHz } : {}),
  };
}
