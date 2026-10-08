import { describe, expect, it } from "vitest";
import type { KeptUp } from "./api.ts";
import { chooseInGroup, facets, filterChips, grouped, keptLowFor, lengthOf, narrow, phaseOf, shown } from "./chips.ts";

describe("what a filter's name says", () => {
  it("reads the phase from the suffix", () => {
    expect([
      phaseOf("poly-sinc-gauss-hires-lp"),
      phaseOf("poly-sinc-mp"),
      phaseOf("poly-sinc-ip"),
      phaseOf("minphaseFIR"),
      phaseOf("sinc-M"),
    ]).toEqual(["linear phase", "minimum phase", "intermediate phase", "minimum phase", null]);
  });
  it("reads the length, and two-stage", () => {
    expect([
      lengthOf("poly-sinc-short-mp"),
      lengthOf("poly-sinc-gauss-long"),
      lengthOf("poly-sinc-gauss-xla"),
      lengthOf("poly-sinc-ext2"),
      lengthOf("sinc-L-2s"),
    ]).toEqual(["short", "long", "extra long", null, "two-stage"]);
  });
});

describe("a filter's chips", () => {
  const item = {
    index: 3,
    name: "poly-sinc-gauss-hires-lp",
    rating: 5,
    tags: ["transients", "timbre"],
    apodizing: true as const,
  };

  it("puts status first (in use, kept up here), then facts", () => {
    const c = filterChips(item, { inUse: true, keptLow: 2.1 });
    expect(c.slice(0, 2).map((x) => [x.kind, x.label])).toEqual([
      ["inuse", "in use"],
      ["good", "✓ kept up here (2.1×)"],
    ]);
    expect(c.map((x) => x.label)).toContain("★ 5/5");
    expect(c.map((x) => x.label)).toContain("linear phase");
    expect(c.map((x) => x.label)).toContain("apodizing");
  });

  it("marks trouble here and can't-play-this-ratio with a ✗, never by colour alone", () => {
    const c = filterChips(
      { ...item, warn: "failed here 2× at these settings", blocked: "needs a power-of-two ratio" },
      { inUse: false },
    );
    expect(c.filter((x) => x.kind === "trouble").map((x) => x.label)).toEqual(["✗ fell behind here", "✗ won't play this ratio"]);
  });

  it("shows at most four, saying how many more there are", () => {
    const c = filterChips(item, { inUse: true, keptLow: 2.1 });
    const s = shown(c);
    expect(s.chips).toHaveLength(4);
    expect(s.more).toBe(c.length - 4);
  });
});

describe("narrowing by chips", () => {
  const rows = [
    { name: "a", chips: filterChips({ index: 0, name: "a-lp", rating: 5 }, { inUse: false, keptLow: 1.5 }) },
    { name: "b", chips: filterChips({ index: 1, name: "b-mp", rating: 3 }, { inUse: false }) },
    { name: "c", chips: filterChips({ index: 2, name: "c-lp", rating: 5 }, { inUse: false }) },
  ];
  it("keeps the rows that have every chip chosen", () => {
    expect(narrow(rows, new Set(["5/5", "phase:linear phase"])).map((r) => r.name)).toEqual(["a", "c"]);
    expect(narrow(rows, new Set(["kept"])).map((r) => r.name)).toEqual(["a"]);
    expect(narrow(rows, new Set()).length).toBe(3);
  });
  it("offers the chips that would narrow the list, in a steady order: status, rating, phase…", () => {
    const f = facets(rows.map((r) => r.chips));
    expect(f.map((x) => x.key)).toEqual(["kept", "5/5", "phase:linear phase", "phase:minimum phase"]);
    expect(f.some((x) => x.count === rows.length)).toBe(false); // a chip every row has narrows nothing
  });
});

describe("kept up here, for a filter", () => {
  const k = (o: Partial<KeptUp>): KeptUp =>
    ({
      mode: "SDM (DSD)",
      rateHz: 11_289_600,
      filterNx: "nx",
      filter1x: "x1",
      shaper: "s",
      sourceRate: 44_100,
      low: 2,
      typical: 2.2,
      sessions: 1,
      first: "",
      at: "",
      ...o,
    }) as KeptUp;
  it("takes the worst low among records with this filter in the slot, at this mode and rate", () => {
    const list = [
      k({ filter1x: "f", low: 2.1 }),
      k({ filter1x: "f", low: 1.6, shaper: "t" }),
      k({ filter1x: "f", rateHz: 22_579_200, low: 0.9 }),
    ];
    expect(keptLowFor(list, { mode: "SDM (DSD)", rateHz: 11_289_600, slot: "1x", name: "f" })).toBe(1.6);
    expect(keptLowFor(list, { mode: "SDM (DSD)", rateHz: 11_289_600, slot: "Nx", name: "f" })).toBeNull();
  });
});

describe("grouping the chip filters (too many to show on a phone)", () => {
  const f = facets([
    filterChips({ index: 0, name: "a-lp", rating: 5, apodizing: true }, { inUse: false }),
    filterChips({ index: 1, name: "b-mp" }, { inUse: false }),
    filterChips({ index: 2, name: "c-short-lp" }, { inUse: false }),
  ]);
  it("keeps status, 5/5 and apodizing as chips, and puts phase, ratio, focus and length in drop-downs", () => {
    const g = grouped(f);
    expect(g.chips.map((c) => c.key)).toEqual(["5/5", "apodizing"]);
    expect(g.groups.map((x) => [x.label, x.options.map((o) => o.label)])).toEqual([
      ["Phase", ["linear phase", "minimum phase"]],
      ["Length", ["short"]],
    ]);
  });
  it("takes one choice per drop-down", () => {
    const keys = new Set(["5/5", "phase:linear phase"]);
    chooseInGroup(keys, "phase:", "phase:minimum phase");
    expect([...keys]).toEqual(["5/5", "phase:minimum phase"]);
    chooseInGroup(keys, "phase:", "");
    expect([...keys]).toEqual(["5/5"]);
  });
});
