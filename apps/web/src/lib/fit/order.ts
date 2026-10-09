// "No heavier than": which settings cost the CPU no more than which, from what Signalyst
// has said and the manual's tap counts. Deliberately sparse: Jussi says load depends on the
// ratio and the hardware, so there is no complexity chart (docs/filter-research.local.md,
// rule 8). A pair with no known link is unknown, never guessed. Each link says where it
// comes from, and whether the load part is inferred (e.g. from a tap count).
import type { Cite } from "../advice/filter-notes.ts";

export interface Basis {
  /** The link, in plain words: "sinc-Lh is about an eighth of sinc-L's load". */
  says: string;
  cites: Cite[];
  /** The load follows from something else the source says (taps, length), not stated. */
  inferred: boolean;
}

/** A known step: `from` costs no more than `to`. */
export interface Step {
  from: string;
  to: string;
  basis: Basis;
}

const H6: Cite = { label: "HQPlayer 6 help" };
const M: Cite = { label: "Manual 6.1.1 §4.6" };
const J_SAME_CPU: Cite = {
  label: "Jussi",
  url: "https://community.roonlabs.com/t/cant-get-hqplayer-discovered-bonjour-seems-to-not-be-working/312532/13",
  date: "2025-12",
};
const roon = (topicPost: string) => `https://community.roonlabs.com/t/${topicPost}`;
const EC_CITES: Cite[] = [
  { label: "Jussi", url: roon("166213/730"), date: "2023-05" },
  { label: "Jussi", url: roon("166213/2099"), date: "2026-01" },
];

// `n`: the tap counts per unit of ratio (manual), for the reader; the sentence leaves them out.
const taps = (from: string, to: string, _n: string): [string, string, Basis] => [
  from,
  to,
  { says: `${from} has fewer taps than ${to}`, cites: [M, H6], inferred: true },
];
const same = (a: string, b: string): [string, string, Basis][] => {
  const basis: Basis = { says: `${a} and ${b} cost about the same CPU`, cites: [J_SAME_CPU], inferred: false };
  return [
    [a, b, basis],
    [b, a, basis],
  ];
};

// [lighter or equal, heavier or equal, why]
const FILTER_LINKS: [string, string, Basis][] = [
  ["sinc-Lh", "sinc-L", { says: "sinc-Lh is about an eighth of sinc-L's load", cites: [M, H6], inferred: false }],
  // 4096, 16384 (Lm and Lh), 65536, 131070 taps × ratio. Lm and Lh: same taps, not linked.
  taps("sinc-Ls", "sinc-Lm", "4096 < 16384"),
  taps("sinc-Ls", "sinc-Lh", "4096 < 16384"),
  taps("sinc-Lm", "sinc-Ll", "16384 < 65536"),
  taps("sinc-Lh", "sinc-Ll", "16384 < 65536"),
  taps("sinc-Ll", "sinc-L", "65536 < 131070"),
  ...same("poly-sinc-ext2-long", "poly-sinc-gauss-long"),
  ...same("poly-sinc-ext2-hires-lp", "poly-sinc-gauss-hires-lp"),
  [
    "poly-sinc-ext2-long",
    "poly-sinc-ext2-xla",
    { says: "poly-sinc-ext2-xla is eight times the length of ext2-long", cites: [H6], inferred: true },
  ],
];

const TWO_STAGE: Basis = {
  says: "a two-stage (-2s) filter does the same job with less CPU (or the same, below 16x)",
  cites: [H6],
  inferred: false,
};

function filterNext(name: string): Step[] {
  const out = FILTER_LINKS.filter(([a]) => a === name).map(([from, to, basis]) => ({ from, to, basis }));
  if (name.endsWith("-2s")) out.push({ from: name, to: name.slice(0, -3), basis: TWO_STAGE });
  return out;
}

const EC_ORDER = ["ul", "light", "fast", "super"];
const EC_RE = /^(ASDM[57]EC)-(ul|light|fast|super)( 512\+fs)?$/;

function shaperNext(name: string): Step[] {
  const m = EC_RE.exec(name);
  const next = m ? EC_ORDER[EC_ORDER.indexOf(m[2]!) + 1] : undefined;
  if (!m || !next) return [];
  const to = `${m[1]}-${next}${m[3] ?? ""}`;
  const basis: Basis = { says: `${to} is the heavier EC variant (-ul, -light, -fast, -super)`, cites: EC_CITES, inferred: false };
  return [{ from: name, to, basis }];
}

/** The steps showing `a` costs no more than `b`: [] when they're the same, undefined when unknown. */
function walk(a: string, b: string, next: (n: string) => Step[]): Step[] | undefined {
  if (a === b) return [];
  const seen = new Set([a]);
  let frontier: { at: string; path: Step[] }[] = [{ at: a, path: [] }];
  while (frontier.length) {
    const out: typeof frontier = [];
    for (const { at, path } of frontier)
      for (const s of next(at)) {
        if (s.to === b) return [...path, s];
        if (!seen.has(s.to)) {
          seen.add(s.to);
          out.push({ at: s.to, path: [...path, s] });
        }
      }
    frontier = out;
  }
  return undefined;
}

export const filterNoHeavier = (a: string, b: string) => walk(a, b, filterNext);
export const shaperNoHeavier = (a: string, b: string) => walk(a, b, shaperNext);

const RATE_BASIS: Basis = { says: "a lower output rate is less work, all else equal", cites: [], inferred: true };

/** What one run costs depends on: the mode, output rate, the filter in use, the modulator or dither. */
export interface Run {
  mode: string;
  rateHz: number;
  /** The filter in use for this source rate (1x or Nx slot). */
  filter: string;
  shaper: string;
  sourceRate: number;
}

/**
 * The steps showing run `a` costs no more than run `b`, or undefined when that isn't known.
 * Only runs from the same source rate in the same mode compare: the ratio changes the load.
 */
export function runNoHeavier(a: Run, b: Run): Step[] | undefined {
  if (a.mode !== b.mode || a.sourceRate !== b.sourceRate || a.rateHz > b.rateHz) return undefined;
  const f = filterNoHeavier(a.filter, b.filter);
  const s = f && shaperNoHeavier(a.shaper, b.shaper);
  if (!f || !s) return undefined;
  const rate = a.rateHz < b.rateHz ? [{ from: `${a.rateHz}`, to: `${b.rateHz}`, basis: RATE_BASIS }] : [];
  return [...f, ...s, ...rate];
}
