// Will a combination run here? Rules first (the filter's ratio, the modulator's floor:
// compat.ts), then what this machine has measured (evidence.ts). And, for "Make it fit",
// the fewest changes that would get a combination there with some settings pinned. Pure
// logic for the filter picker's three ways in (case 1: filters that fit as set; case 2:
// the guide, then case 1; case 3: pin a filter, free the rest).
import { ditherHint, filterSlot, modulatorHint, ratioHint, type Hint, type RatioClass } from "@app/protocol/compat";
import type { Combo, Failure, KeptUp } from "../api.ts";
import { DEFAULT_MAX_AGE_DAYS, loadEvidence, runOf, type LoadEvidence } from "./evidence.ts";
import { filterNoHeavier, runNoHeavier } from "./order.ts";

/**
 * - wont: a hard rule says it can't, or it failed here last time;
 * - doubtful: something no heavier failed here, it ran slow, or the evidence disagrees;
 * - fits: it, or something no lighter, kept up here;
 * - try: no rule against it and nothing measured: only trying tells.
 */
export type Verdict = "wont" | "doubtful" | "fits" | "try";

export interface FitInput {
  combo: Combo;
  sourceRate: number;
  sdm: boolean;
  /** HQPlayer 6's own ratio class for a filter (its description), when it gives one. */
  ratioOf?: (filter: string) => RatioClass | undefined;
  /** False when the rate is Auto: HQPlayer then picks a rate the filter can do. */
  ratioFixed?: boolean;
  /** Records older than this many days don't count (null: forever); default evidence.ts's. */
  maxAgeDays?: number | null;
}

export interface Fit {
  verdict: Verdict;
  /** Rule hints: hard ones make it "wont", soft ones are notes (outside the recommended range). */
  rules: Hint[];
  load: LoadEvidence;
}

/** The combination's field for the filter this source uses (1x below 50 kHz, manual §4.6). */
export const slotOf = (sourceRate: number) => (filterSlot(sourceRate) === "1x" ? "filter1x" : "filterNx");

export function fit(x: FitInput, failures: Failure[], kept: KeptUp[]): Fit {
  const filter = x.combo[slotOf(x.sourceRate)];
  const rules = [
    x.ratioFixed === false ? undefined : ratioHint(filter, x.sourceRate, x.combo.rateHz, x.sdm, x.ratioOf?.(filter)),
    x.sdm ? modulatorHint(x.combo.shaper, x.combo.rateHz) : ditherHint(x.combo.shaper, x.combo.rateHz),
  ].filter((h): h is Hint => !!h);
  const load = loadEvidence(
    x.combo,
    x.sourceRate,
    failures,
    kept,
    x.maxAgeDays === undefined ? DEFAULT_MAX_AGE_DAYS : x.maxAgeDays,
  );
  const verdict: Verdict =
    rules.some((r) => r.level === "hard") || load.kind === "failed"
      ? "wont"
      : load.kind === "slow" || load.kind === "likely-fails" || load.kind === "mixed"
        ? "doubtful"
        : load.kind === "kept" || load.kind === "likely-keeps"
          ? "fits"
          : "try";
  return { verdict, rules, load };
}

export type Pin = "filter" | "shaper" | "rateHz";

export interface Options {
  /** Filters on offer for the slot this source uses. */
  filters: string[];
  shapers: string[];
  /** Output rates on offer in this mode, Hz. */
  rates: number[];
}

export interface Suggestion {
  change: { filter?: string; shaper?: string; rateHz?: number };
  combo: Combo;
  fit: Fit;
  /** Known to cost no more than the starting combination (order.ts). */
  lighter: boolean;
}

const RANK: Record<Verdict, number> = { fits: 0, try: 1, doubtful: 2, wont: 3 };

/**
 * The fewest changes to the unpinned settings that make `x` fit (or at least worth a try),
 * nearest first: one change before two; measured to fit before untried; known-lighter
 * before not (a -2s variant, a lower rate, a lighter EC variant); then the smallest move.
 */
export function nearestFits(
  x: FitInput,
  pinned: ReadonlySet<Pin>,
  o: Options,
  failures: Failure[],
  kept: KeptUp[],
  max = 3,
): Suggestion[] {
  const slot = slotOf(x.sourceRate);
  const start = runOf(x.combo, x.sourceRate);
  const rates = [...o.rates].sort((a, b) => a - b);
  const step = (hz: number) => Math.abs(rates.indexOf(hz) - rates.indexOf(x.combo.rateHz));
  const sameFamily = (a: string, b: string) =>
    a.replace(/-(ul|light|fast|super)/, "") === b.replace(/-(ul|light|fast|super)/, "");

  const moves: { pin: Pin; change: Suggestion["change"]; cost: number }[] = [];
  if (!pinned.has("filter"))
    for (const f of o.filters)
      if (f !== start.filter)
        moves.push({ pin: "filter", change: { filter: f }, cost: filterNoHeavier(f, start.filter) ? 0 : 1 });
  if (!pinned.has("shaper"))
    for (const s of o.shapers)
      if (s !== x.combo.shaper)
        moves.push({ pin: "shaper", change: { shaper: s }, cost: sameFamily(s, x.combo.shaper) ? 0.5 : 1 });
  if (!pinned.has("rateHz"))
    for (const r of rates) if (r !== x.combo.rateHz) moves.push({ pin: "rateHz", change: { rateHz: r }, cost: step(r) });

  const tries = [
    ...moves.map((m) => ({ changes: 1, cost: m.cost, change: m.change })),
    ...moves.flatMap((a, i) =>
      moves
        .slice(i + 1)
        .filter((b) => b.pin !== a.pin)
        .map((b) => ({ changes: 2, cost: a.cost + b.cost, change: { ...a.change, ...b.change } })),
    ),
  ];

  const out = tries
    .map((t) => {
      const combo: Combo = {
        ...x.combo,
        ...(t.change.filter !== undefined ? { [slot]: t.change.filter } : {}),
        ...(t.change.shaper !== undefined ? { shaper: t.change.shaper } : {}),
        ...(t.change.rateHz !== undefined ? { rateHz: t.change.rateHz } : {}),
      };
      const f = fit({ ...x, combo, ...(t.change.rateHz !== undefined ? { ratioFixed: true } : {}) }, failures, kept);
      const lighter = !!runNoHeavier(runOf(combo, x.sourceRate), start);
      return { ...t, s: { change: t.change, combo, fit: f, lighter } };
    })
    .filter((t) => t.s.fit.verdict === "fits" || t.s.fit.verdict === "try");
  out.sort(
    (a, b) =>
      a.changes - b.changes ||
      RANK[a.s.fit.verdict] - RANK[b.s.fit.verdict] ||
      Number(b.s.lighter) - Number(a.s.lighter) ||
      a.cost - b.cost,
  );
  return out.slice(0, max).map((t) => t.s);
}
