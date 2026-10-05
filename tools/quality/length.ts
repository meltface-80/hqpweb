// File-length tripwire (docs/quality-plan.md, "File length"): the decision, kept
// free of I/O so it can be tested. measure.ts does the reading and printing.

/** fail: the commit check fails above it. report: listed by `npm run lines`. warn: an agent is told at edit time. */
export const LIMITS = { fail: 600, report: 400, warn: 500 } as const;

/** The files the tripwire measures. */
export const CODE = /\.(ts|svelte|js|mjs|cjs|py)$/;

/** Lines per file, counted like `wc -l`. */
export type Counts = Record<string, number>;

export interface Verdict {
  /** Each makes the check fail. */
  failures: string[];
  /** Over the report threshold: shown, not failing. */
  reports: string[];
}

/**
 * Files over the limit must be in the baseline (files that were already too long
 * when the limit came in) and may not grow. A baseline entry that's out of date
 * (the file shrank, or is gone) also fails, so the allowance only ever tightens.
 */
export function judge(counts: Counts, baseline: Counts, limits: { fail: number; report: number } = LIMITS): Verdict {
  const failures: string[] = [];
  const reports: string[] = [];
  for (const [file, n] of Object.entries(counts).sort()) {
    const allowed = baseline[file];
    if (allowed === undefined) {
      if (n > limits.fail) failures.push(`${file}: ${n} lines, over the ${limits.fail}-line limit. Split it.`);
      else if (n > limits.report) reports.push(`${file}: ${n} lines`);
    } else if (n > allowed) {
      failures.push(`${file}: ${n} lines, up from ${allowed}. It's already over the limit: split it before adding.`);
    } else if (n < allowed) {
      failures.push(`${file}: ${n} lines, down from ${allowed}. Good: run \`npm run lines -- --ratchet\` to record it.`);
    } else {
      reports.push(`${file}: ${n} lines (over the limit; may not grow)`);
    }
  }
  for (const file of Object.keys(baseline).sort())
    if (counts[file] === undefined)
      failures.push(`${file}: gone, but still in the baseline. Run \`npm run lines -- --ratchet\`.`);
  return { failures, reports };
}

/** The baseline brought up to date: entries only shrink or disappear, never grow or appear. */
export function ratchet(counts: Counts, baseline: Counts, limits: { fail: number } = LIMITS): Counts {
  const next: Counts = {};
  for (const [file, allowed] of Object.entries(baseline)) {
    const n = counts[file];
    if (n !== undefined && n > limits.fail) next[file] = Math.min(n, allowed);
  }
  return next;
}
