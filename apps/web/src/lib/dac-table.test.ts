import { describe, expect, it } from "vitest";
import { DAC_MODELS } from "./dac-models.ts";
import {
  dayLabel,
  dsdLabel,
  filterModels,
  groupByMaker,
  hasNote,
  monthLabel,
  OUR_READING,
  pcmLabel,
  rowNote,
} from "./dac-table.ts";
import type { DacModel } from "./dacs.ts";

// Invented rows, so the tests don't move when the real table is corrected.
const row = (id: string, maker: string, models: string[], chip: string, extra: Partial<DacModel> = {}): DacModel => ({
  id,
  maker,
  models,
  chip,
  dsd: "direct",
  pcm: "delta-sigma",
  sources: [],
  ...extra,
});
const ROWS = [
  row("a1", "Zeta", ["One", "One Plus"], "ES9038PRO"),
  row("b1", "Bolt", ["Ladder X"], "R2R ladder"),
  row("a2", "Zeta", ["Two"], "AK4493"),
  row("c1", "Crest", ["Mini"], "ES9039SPRO"),
];
const ids = (rows: DacModel[]) => rows.map((r) => r.id);

describe("Find your DAC: filtering the models", () => {
  it("shows every row for an empty or blank query", () => {
    expect(ids(filterModels(ROWS, "  "))).toEqual(["a1", "b1", "a2", "c1"]);
  });

  it("matches the maker, ignoring case", () => {
    expect(ids(filterModels(ROWS, "zEtA"))).toEqual(["a1", "a2"]);
  });

  it("matches any of a row's model names", () => {
    expect(ids(filterModels(ROWS, "one plus"))).toEqual(["a1"]);
  });

  it("matches the chip", () => {
    expect(ids(filterModels(ROWS, "es9039"))).toEqual(["c1"]);
  });

  it("needs every word to match, in any order", () => {
    expect(ids(filterModels(ROWS, "two zeta"))).toEqual(["a2"]);
  });

  it("matches nothing when no row has the words", () => {
    expect(filterModels(ROWS, "zebra")).toEqual([]);
  });

  it("finds a Holo row and no Topping row for 'holo' in the real table", () => {
    const makers = new Set(filterModels(DAC_MODELS, "holo").map((m) => m.maker));
    expect([makers.has("Holo Audio"), makers.has("Topping")]).toEqual([true, false]);
  });
});

describe("Find your DAC: grouping by maker", () => {
  it("keeps makers in the order they first appear, with each maker's rows together", () => {
    const groups = groupByMaker(ROWS).map((g) => [g.maker, ids(g.models)]);
    expect(groups).toEqual([
      ["Zeta", ["a1", "a2"]],
      ["Bolt", ["b1"]],
      ["Crest", ["c1"]],
    ]);
  });

  it("leaves out a maker none of whose rows matched", () => {
    expect(groupByMaker(filterModels(ROWS, "ladder")).map((g) => g.maker)).toEqual(["Bolt"]);
  });
});

describe("Find your DAC: the answer cells", () => {
  it("labels each DSD answer", () => {
    const labels = (["older-ess", "remodulates", "direct", "converts"] as const).map((d) => dsdLabel(d).label);
    expect(labels).toEqual(["Older ESS", "Re-processes", "Direct", "Converts / none"]);
  });

  it("labels each PCM answer, and a DAC with no PCM input", () => {
    const labels = (["ladder", "delta-sigma", undefined] as const).map((p) => pcmLabel(p).label);
    expect(labels).toEqual(["Ladder", "Delta-sigma", "No PCM input"]);
  });
});

describe("Find your DAC: a row's note", () => {
  const advice = (date: string, about: "modulator" | "dither" | "hardware" = "modulator") => ({
    text: "Seventh order.",
    url: "https://community.roonlabs.com/t/1/2",
    date,
    about,
  });

  it("names the month of a post, as 'Mon YYYY' ('Sept' for September)", () => {
    expect([monthLabel("2025-08"), monthLabel("2026-09"), monthLabel("2016-01")]).toEqual(["Aug 2025", "Sept 2026", "Jan 2016"]);
  });

  it("names the day the table was checked, as 'D Mon YYYY'", () => {
    expect(dayLabel("2026-10-05")).toBe("5 Oct 2026");
  });

  it("leads with the row's note, then its native DSD rate", () => {
    const n = rowNote(row("x", "Zeta", ["One"], "chip", { note: "PCM only.", dsdMax: "DSD256" }));
    expect(n.lead).toBe("PCM only. Native DSD up to DSD256.");
  });

  it("cites each piece of advice as 'Jussi, Mon YYYY', with its link", () => {
    const n = rowNote(row("x", "Zeta", ["One"], "chip", { advice: [advice("2025-08", "dither")] }));
    expect(n.advice).toEqual([
      { text: "Seventh order.", url: "https://community.roonlabs.com/t/1/2", cite: "Jussi, Aug 2025", dated: null },
    ]);
  });

  it("flags modulator advice from before HQPlayer 5.11's modulators as dated", () => {
    const n = rowNote(row("x", "Zeta", ["One"], "chip", { advice: [advice("2024-08"), advice("2025-03")] }));
    expect(n.advice.map((a) => a.dated?.label ?? null)).toEqual(["before 5.11's modulators", null]);
  });

  it("ends with our-reading, then the models it isn't", () => {
    const n = rowNote(row("x", "Zeta", ["D9"], "chip", { ourReading: true, notThese: ["D9 SE", "D9 LE"] }));
    expect(n.tail).toBe(`${OUR_READING} Not the D9 SE, D9 LE.`);
  });

  it("has nothing to show for a bare row", () => {
    expect(hasNote(rowNote(row("x", "Zeta", ["One"], "chip")))).toBe(false);
  });

  it("has something to show when only advice is there", () => {
    expect(hasNote(rowNote(row("x", "Zeta", ["One"], "chip", { advice: [advice("2025-08")] })))).toBe(true);
  });
});
