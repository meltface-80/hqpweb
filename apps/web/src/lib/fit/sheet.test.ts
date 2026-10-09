import { describe, expect, it } from "vitest";
import type { Capabilities, Failure, KeptUp, Snapshot } from "../api.ts";
import { context } from "../hints.ts";
import {
  filterFit,
  fitsAsSet,
  sheetFit,
  suggestionChange,
  suggestionLabel,
  suggestionStatus,
  tryAnyway,
  whatItTakes,
  whyNot,
} from "./sheet.ts";

// A small SDM instance, playing a CD-rate track at a fixed DSD256 with sinc-L as the 1x filter.
const named = (names: string[]) => names.map((name, index) => ({ index, name }));
const FILTERS = named(["sinc-L", "sinc-Lh", "sinc-M", "poly-sinc-gauss-long", "poly-sinc-gauss-hires-lp"]);
const SHAPERS = named(["ASDM7EC-light", "ASDM7EC-fast", "ASDM7EC-super", "AHM7EC8B"]);
const DSD128 = 5_644_800;
const DSD256 = 11_289_600;
const DSD256_48 = 12_288_000;
const RATES = [0, DSD128, DSD256, DSD256_48].map((rate, index) => ({ index, rate, allowed: true }));
const MODE = "SDM (DSD)";

const caps = (knownBad: Failure[] = [], keptUp: KeptUp[] = [], o: Partial<Capabilities> = {}): Capabilities => ({
  engine: "6.2.5",
  mode: { index: 2, name: MODE, value: 1 },
  modes: [],
  filters: FILTERS,
  shapers: SHAPERS,
  rates: RATES,
  rateSettable: true,
  matrixProfiles: [],
  volumeRange: { min: -60, max: 0, enabled: true },
  knownBad,
  keptUp,
  lastSeen: {},
  modeLists: {},
  ...o,
});
const idx = (list: { index: number; name: string }[], n: string) => list.find((x) => x.name === n)!.index;
const snap = (o: { source?: number; rate?: number } = {}): Snapshot =>
  ({
    status: {
      state: 2,
      activeRate: DSD256,
      source: { sampleRate: o.source ?? 44_100, bits: 16, channels: 2, song: "x" },
    },
    state: {
      rate: o.rate ?? RATES.findIndex((r) => r.rate === DSD256),
      filter1x: idx(FILTERS, "sinc-L"),
      filterNx: idx(FILTERS, "poly-sinc-gauss-hires-lp"),
      shaper: idx(SHAPERS, "ASDM7EC-super"),
    },
  }) as unknown as Snapshot;
const combo = { mode: MODE, rateHz: DSD256, filter1x: "sinc-L", filterNx: "poly-sinc-gauss-hires-lp", shaper: "ASDM7EC-super" };
const failure = (o: Partial<Failure> = {}): Failure => ({
  ...combo,
  reason: "HQPlayer stopped",
  at: "2026-10-01T12:00:00Z",
  sourceRates: [44_100],
  ...o,
});
const sf = (c: Capabilities, s = snap()) => sheetFit(context(c, s), "1x")!;

describe("the filter sheet's fit", () => {
  it("only splits the slot this source uses", () => {
    expect(sheetFit(context(caps(), snap()), "1x")).not.toBeNull();
    expect(sheetFit(context(caps(), snap()), "Nx")).toBeNull();
    expect(sheetFit(context(caps(), snap({ source: 96_000 })), "Nx")).not.toBeNull();
  });

  it("explains a ratio it can't do, from 48k", () => {
    const s = sf(caps(), snap({ source: 48_000 }));
    const f = filterFit(s, "sinc-M");
    expect(fitsAsSet(f)).toBe(false);
    expect(whyNot(s, "sinc-M", f)).toMatch(/^sinc-M needs a power-of-two ratio/);
  });

  it("says why sinc-L is below the line when sinc-Lh failed, citing the link", () => {
    const s = sf(caps([failure({ filter1x: "sinc-Lh" })]));
    const f = filterFit(s, "sinc-L");
    expect(f.verdict).toBe("doubtful");
    const why = whyNot(s, "sinc-L", f)!;
    expect(why).toMatch(/^Here, sinc-Lh couldn't keep up, and this is no lighter/);
    expect(why).toMatch(/eighth of sinc-L's load/);
    expect(tryAnyway(why)).toMatch(/may stall HQPlayer; hqpweb tries to roll back\. Try anyway\?$/);
  });

  it("names what differs in the run it infers from: only the rate", () => {
    const s = sf(caps([failure({ rateHz: DSD128 })]));
    expect(whyNot(s, "sinc-L", filterFit(s, "sinc-L"))).toMatch(/^Here, the same settings at DSD128 couldn't keep up/);
  });

  it("says when it failed here itself, and leaves a filter that fits alone", () => {
    const s = sf(caps([failure()]));
    expect(whyNot(s, "sinc-L", filterFit(s, "sinc-L"))).toMatch(/^Failed here once at these settings/);
    expect(whyNot(s, "poly-sinc-gauss-long", filterFit(s, "poly-sinc-gauss-long"))).toBeNull();
  });

  it("says a slow run in numbers", () => {
    const kept: KeptUp = { ...combo, sourceRate: 44_100, low: 0.87, typical: 0.9, sessions: 1, first: "x", at: "x" };
    const s = sf(caps([], [kept]));
    expect(whyNot(s, "sinc-L", filterFit(s, "sinc-L"))).toBe("Ran 0.87× here: slower than real time.");
  });

  it("suggests what it would take, in words, and the change to apply", () => {
    const s = sf(caps([failure()]));
    const sg = whatItTakes(s, "sinc-L", { shaper: true, rate: false });
    expect(sg.every((x) => x.change.shaper === undefined)).toBe(true);
    expect(suggestionLabel(sg[0]!, s.input.combo)).toBe("DSD128 instead of DSD256");
    expect(suggestionStatus(sg[0]!)).toBe("untried; lighter");
    expect(suggestionChange(s, "sinc-L", sg[0]!)).toEqual({ filter1x: "sinc-L", rate: DSD128 });
  });

  it("doesn't suggest a rate where the mode can't set one", () => {
    const s = sf(caps([failure()], [], { rateSettable: false }));
    expect(whatItTakes(s, "sinc-L", { shaper: false, rate: false }).every((x) => x.change.rateHz === undefined)).toBe(true);
  });
});
