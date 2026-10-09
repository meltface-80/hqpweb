import { describe, expect, it } from "vitest";
import type { KeptUp } from "./api.ts";
import { facets, grouped, narrow } from "./chips.ts";
import { SHAPER_GROUPS, keptLowForShaper, shaperChips } from "./shaper-chips.ts";

const DSD256 = 11_289_600;
const DSD1024 = 45_158_400;
const sdm = { isSdm: true, inUse: false, rateHz: DSD256 };
const labels = (c: { label: string }[]) => c.map((x) => x.label);

describe("a modulator's chips", () => {
  it("puts status first, then the guide's start, then what the advice data says", () => {
    const c = shaperChips(
      { name: "ASDM7EC-super", gen: 7 },
      { ...sdm, inUse: true, keptLow: 1.8, badge: { text: "For your answers", kind: "yours" } },
    );
    expect(c.map((x) => x.kind).slice(0, 3)).toEqual(["inuse", "good", "suggested"]);
    expect(labels(c)).toEqual([
      "in use",
      "✓ kept up here (1.8×)",
      "For your answers",
      "seventh order",
      "EC line: heaviest",
      "Gen 7",
    ]);
  });

  it("tells a rate it can't play from a failure here, each with a ✗", () => {
    expect(labels(shaperChips({ name: "AHM7EC8B", warn: "won't play: needs DSD1024 or higher" }, sdm))[0]).toBe(
      "✗ won't play at this rate",
    );
    expect(labels(shaperChips({ name: "ASDM7EC-fast", warn: "failed here 2× at these settings" }, sdm))[0]).toBe(
      "✗ fell behind here",
    );
  });

  it("says a fast CPU is needed at DSD1024 for the EC line (Signalyst's word), not for AHM", () => {
    const fast = "needs a fast CPU at this rate";
    expect(labels(shaperChips({ name: "ASDM7EC-fast" }, { ...sdm, rateHz: DSD1024 }))).toContain(fast);
    expect(labels(shaperChips({ name: "ASDM7EC-fast" }, sdm))).not.toContain(fast);
    expect(labels(shaperChips({ name: "AHM7EC8B" }, { ...sdm, rateHz: DSD1024 }))).not.toContain(fast);
  });

  it("doesn't offer that note, or trouble, as a filter", () => {
    const f = facets([
      shaperChips({ name: "ASDM7EC-fast", warn: "failed here" }, { ...sdm, rateHz: DSD1024 }),
      shaperChips({ name: "AHM7EC8B" }, { ...sdm, rateHz: DSD1024 }),
    ]);
    expect(f.map((x) => x.key).sort()).toEqual(["load:AHM: light", "load:EC line: a bit more than -light"]);
  });

  it("names the line a load is ranked in, never a bare CPU load", () => {
    expect(labels(shaperChips({ name: "ASDM5EC-ul" }, sdm))).toContain("EC line: lightest");
    expect(labels(shaperChips({ name: "AHM7EC8B" }, sdm))).toContain("AHM: light");
  });

  it("says nothing it doesn't know: no load, order or family for a name the advice lacks", () => {
    expect(shaperChips({ name: "XYZ9" }, sdm)).toEqual([]);
  });

  it("leaves a caution badge out (the list says it in words)", () => {
    expect(
      shaperChips({ name: "DSD5" }, { ...sdm, badge: { text: "careful", kind: "caution" } }).some((c) => c.kind === "suggested"),
    ).toBe(false);
  });
});

describe("a dither's chips", () => {
  it("has none of the modulator facts (its section names its group)", () => {
    expect(shaperChips({ name: "LNS15" }, { isSdm: false, inUse: false, rateHz: 705_600 })).toEqual([]);
  });
});

describe("filtering the modulator list", () => {
  const rows = ["ASDM7EC-super", "ASDM7EC-light", "ASDM5EC-light", "AHM7EC8B", "DSD5EC"].map((name) => ({
    name,
    chips: shaperChips({ name }, sdm),
  }));
  it("puts order, load and Gen in drop-downs; no family (the sections are the families)", () => {
    const g = grouped(facets(rows.map((r) => r.chips)), SHAPER_GROUPS);
    expect(g.groups.map((x) => x.label)).toEqual(["Order", "Load in its line"]);
    expect(g.chips).toEqual([]);
  });
  it("narrows by order and load together", () => {
    expect(narrow(rows, new Set(["order:7", "load:EC line: heaviest"])).map((r) => r.name)).toEqual(["ASDM7EC-super"]);
    expect(narrow(rows, new Set(["order:7", "load:EC line: light"])).map((r) => r.name)).toEqual(["ASDM7EC-light"]);
  });
});

describe("kept up here, for a modulator", () => {
  const k = (o: Partial<KeptUp>): KeptUp =>
    ({
      mode: "SDM (DSD)",
      rateHz: DSD256,
      filterNx: "n",
      filter1x: "x",
      shaper: "m",
      sourceRate: 44_100,
      low: 2,
      typical: 2,
      sessions: 1,
      first: "",
      at: "",
      ...o,
    }) as KeptUp;
  it("takes the worst low with this modulator, at this mode and rate", () => {
    const list = [
      k({ low: 2.2 }),
      k({ low: 1.4, filterNx: "other" }),
      k({ low: 0.9, rateHz: DSD1024 }),
      k({ low: 0.5, shaper: "z" }),
    ];
    expect(keptLowForShaper(list, { mode: "SDM (DSD)", rateHz: DSD256, name: "m" })).toBe(1.4);
    expect(keptLowForShaper(list, { mode: "PCM", rateHz: DSD256, name: "m" })).toBeNull();
  });
});

describe("load, as a detail", () => {
  it("stays off the row until why?, but still filters", async () => {
    const { shown } = await import("./chips.ts");
    const c = shaperChips({ name: "ASDM7EC-super", gen: 7 }, sdm);
    expect(labels(shown(c).chips)).toEqual(["seventh order", "Gen 7"]);
    expect(shown(c).more).toBe(1);
    const f = facets([c, shaperChips({ name: "ASDM7EC-light", gen: 7 }, sdm)]);
    expect(f.map((x) => x.key)).toContain("load:EC line: heaviest");
  });
});
