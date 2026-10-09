// What this machine has shown about a combination's load: measured here (it failed, ran
// slow, or kept up), or inferred from a measured run through the "no heavier than" order
// (order.ts). Load is never guessed from anything else: with no measured run nearby the
// answer is "none", and the only way to know is to try (roll-back guards it).
import type { Combo, Failure, KeptUp } from "../api.ts";
import { filterSlot } from "@app/protocol/compat";
import { runNoHeavier, type Run, type Step } from "./order.ts";

/** Settled speed at or above this kept up (HQPlayer's process speed: times real time). */
export const KEPT_UP = 1;

export type LoadEvidence =
  | { kind: "failed"; failure: Failure }
  | { kind: "slow"; kept: KeptUp }
  | { kind: "kept"; kept: KeptUp }
  /** Something no heavier failed or ran slow here: this probably won't keep up either. */
  | { kind: "likely-fails"; because: Failure | KeptUp; steps: Step[] }
  /** Something no lighter kept up here: this probably will too. */
  | { kind: "likely-keeps"; because: KeptUp; steps: Step[] }
  /** Both: the evidence disagrees (a failure can have other causes). */
  | { kind: "mixed"; failed: Failure | KeptUp; kept: KeptUp }
  | { kind: "none" };

export const runOf = (c: Combo, sourceRate: number): Run => ({
  mode: c.mode,
  rateHz: c.rateHz,
  shaper: c.shaper,
  filter: filterSlot(sourceRate) === "1x" ? c.filter1x : c.filterNx,
  sourceRate,
});

const sameCombo = (a: Combo, b: Combo) =>
  a.mode === b.mode && a.rateHz === b.rateHz && a.filterNx === b.filterNx && a.filter1x === b.filter1x && a.shaper === b.shaper;

/** Failures name their source rates since beta.5; older ones can't be placed, so they don't infer. */
const failureRuns = (f: Failure): Run[] => (f.sourceRates ?? []).map((r) => runOf(f, r));

const shortest = <T extends { steps: Step[] }>(xs: T[]) => xs.sort((a, b) => a.steps.length - b.steps.length)[0];

export function loadEvidence(c: Combo, sourceRate: number, failures: Failure[], kept: KeptUp[]): LoadEvidence {
  const failed = failures.find((f) => sameCombo(f, c) && (!f.sourceRates || f.sourceRates.includes(sourceRate)));
  const ran = kept.find((k) => sameCombo(k, c) && k.sourceRate === sourceRate);
  // Both measured: the latest says what this machine does now.
  if (failed && (!ran || failed.at >= ran.at)) return { kind: "failed", failure: failed };
  if (ran) return ran.low >= KEPT_UP ? { kind: "kept", kept: ran } : { kind: "slow", kept: ran };

  const target = runOf(c, sourceRate);
  const bad = [
    ...failures.flatMap((f) => failureRuns(f).map((run) => ({ because: f as Failure | KeptUp, run }))),
    ...kept.filter((k) => k.low < KEPT_UP).map((k) => ({ because: k as Failure | KeptUp, run: runOf(k, k.sourceRate) })),
  ]
    .map((x) => ({ because: x.because, steps: runNoHeavier(x.run, target) }))
    .filter((x): x is { because: Failure | KeptUp; steps: Step[] } => !!x.steps);
  const good = kept
    .filter((k) => k.low >= KEPT_UP)
    .map((k) => ({ because: k, steps: runNoHeavier(target, runOf(k, k.sourceRate)) }))
    .filter((x): x is { because: KeptUp; steps: Step[] } => !!x.steps);

  const b = shortest(bad);
  const g = shortest(good);
  if (b && g) return { kind: "mixed", failed: b.because, kept: g.because };
  if (b) return { kind: "likely-fails", because: b.because, steps: b.steps };
  if (g) return { kind: "likely-keeps", because: g.because, steps: g.steps };
  return { kind: "none" };
}
