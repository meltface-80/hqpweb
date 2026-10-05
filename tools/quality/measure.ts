// Code-size measurements for docs/quality-plan.md.
//   npm run lines                    file-length tripwire (CI runs this)
//   npm run lines -- --ratchet       record files that shrank (the baseline only tightens)
//   npm run measure                  the plan's "Where we are" table, re-measured
// Counts files git tracks or would (not ignored ones), lines as `wc -l` counts them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CODE, judge, LIMITS, ratchet, type Counts } from "./length.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const baselinePath = fileURLToPath(new URL("length-baseline.json", import.meta.url));

function count(): Counts {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter((f) => CODE.test(f));
  const counts: Counts = {};
  for (const f of files) {
    try {
      counts[f] = (readFileSync(`${root}/${f}`, "utf8").match(/\n/g) ?? []).length;
    } catch {
      // Deleted in the working tree but not yet staged: not there to measure.
    }
  }
  return counts;
}

const isTest = (f: string) => /(^|\/)test\//.test(f) || /\.(test|spec)\.ts$/.test(f);
const AREAS = [
  ["`apps/web` (UI)", "apps/web/"],
  ["`apps/server`", "apps/server/"],
  ["`packages/protocol`", "packages/protocol/"],
  ["`packages/fake-hqp`", "packages/fake-hqp/"],
  ["`e2e` (browser tests)", "e2e/"],
] as const;

function table(counts: Counts) {
  const n = (x: number) => x.toLocaleString("en-US");
  const rows = AREAS.map(([label, dir]) => {
    const files = Object.entries(counts).filter(([f]) => f.startsWith(dir) && !f.endsWith(".py"));
    const src = files.filter(([f]) => !isTest(f));
    const tests = files.filter(([f]) => isTest(f));
    const testFiles = tests.filter(([f]) => /\.(test|spec)\.ts$/.test(f)).length;
    const sum = (xs: [string, number][]) => xs.reduce((a, [, c]) => a + c, 0);
    const [bigName, big] = src.sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    return `| ${label} | ${n(sum(src))} | ${tests.length ? `${n(sum(tests))} lines, ${testFiles} file${testFiles === 1 ? "" : "s"}` : "none"} | ${big ? `\`${bigName.slice(dir.length)}\` ${n(big)}` : ""} |`;
  });
  const over = (k: number) => Object.values(counts).filter((c) => c > k).length;
  return [
    `| Area | Source lines | Tests | Largest source file |`,
    `| --- | ---: | --- | --- |`,
    ...rows,
    "",
    `Files over ${LIMITS.fail} lines: ${over(LIMITS.fail)}. Over ${LIMITS.report}: ${over(LIMITS.report)}.`,
    `Function size and complexity: \`npm run lint\` reports them as warnings.`,
  ].join("\n");
}

const counts = count();
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Counts;

if (process.argv.includes("--table")) {
  console.log(table(counts));
} else if (process.argv.includes("--ratchet")) {
  const next = ratchet(counts, baseline);
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
  console.log(`baseline: ${JSON.stringify(baseline)} → ${JSON.stringify(next)}`);
  // Ratcheting never raises an entry, so a file that grew is still over: say so, and fail.
  const { failures } = judge(counts, next);
  if (failures.length) {
    console.error(`\nStill failing after the ratchet:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
} else {
  const { failures, reports } = judge(counts, baseline);
  if (reports.length) console.log(`Over ${LIMITS.report} lines (reported):\n  ${reports.join("\n  ")}`);
  if (failures.length) {
    console.error(`\nFile-length check failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`File lengths OK (limit ${LIMITS.fail}).`);
}
