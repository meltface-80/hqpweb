import { describe, expect, it } from "vitest";
import { MODULATORS_V5 as V5, SHAPERS_V5 as SHAPERS } from "./recorded-lists.ts";
import { groupDithers, groupModulators, modulatorFamily, narrowSections, orderOf } from "./catalogue.ts";
import { RULES } from "./policy.ts";

const titles = (s: { title: string }[]) => s.map((x) => x.title);

describe("modulator list grouping", () => {
  it("puts every recorded modulator in a family", () => {
    expect(V5.filter((n) => modulatorFamily(n) === null)).toEqual([]);
  });

  it("reads the order from the name", () => {
    expect([orderOf("ASDM5EC-fast"), orderOf("AHM7EC4B"), orderOf("DSD7"), orderOf("XYZ")]).toEqual([5, 7, 7, null]);
  });

  it("groups by family, newest first, with the older series folded", () => {
    const s = groupModulators(V5, null);
    expect(s.map((x) => [x.title, x.open])).toEqual([
      ["Newest EC line", true],
      ["AHM, for DSD1024 and up", true],
      ["AMSDM, pseudo-multi-bit", false],
      ["Older EC series", false],
      ["Basic", false],
    ]);
  });

  it("shows your order in each family and folds the other order at the end", () => {
    const s = groupModulators(V5, 7);
    expect([s[0]!.names.every((n) => n.startsWith("ASDM7")), s.at(-1)?.title, s.at(-1)?.open]).toEqual([
      true,
      "Fifth order",
      false,
    ]);
  });

  it("keeps both orders of AHM, since the DSD1024 choice depends on the amplifier", () => {
    expect(groupModulators(V5, 7).find((x) => x.key === "ahm")?.names).toEqual(["AHM5EC5L", "AHM7EC5L", "AHM5EC8B", "AHM7EC8B"]);
  });

  it("never hides a modulator the rules don't know", () => {
    const s = groupModulators([...V5, "AHM7EC9X"], 7);
    expect(s.find((x) => x.key === "unknown")).toEqual({
      key: "unknown",
      title: "Newer than hqpweb's advice",
      names: ["AHM7EC9X"],
      open: true,
    });
  });

  it("notes on the older series why the newest EC line is the one to use, citing the posts", () => {
    const notes = Object.fromEntries(groupModulators(V5, null).map((x) => [x.key, x.note ?? null]));
    expect([notes.new, notes.ahm, notes.olderEc, notes.basic]).toEqual([null, null, RULES.olderGen, RULES.basicGen]);
  });

  it("loses no name between the sections", () => {
    expect(
      groupModulators(V5, 5)
        .flatMap((x) => x.names)
        .sort(),
    ).toEqual([...V5].sort());
  });
});

describe("dither list grouping", () => {
  it("puts flat dither first, shapers next, the rest under More, and none on its own", () => {
    expect(titles(groupDithers(SHAPERS))).toEqual(["Flat dither", "Noise shaping, for ladder DACs", "More", "Not for listening"]);
  });

  it("folds More by default", () => {
    expect(groupDithers(SHAPERS).find((x) => x.key === "more")?.open).toBe(false);
  });

  it("files a shaper it doesn't know under More rather than dropping it", () => {
    expect(groupDithers([...SHAPERS, "NS99"]).find((x) => x.key === "more")?.names).toContain("NS99");
  });

  it("loses no name between the sections", () => {
    expect(
      groupDithers(SHAPERS)
        .flatMap((x) => x.names)
        .sort(),
    ).toEqual([...SHAPERS].sort());
  });
});

describe("narrowing the list (search, works here)", () => {
  const sections = groupModulators(V5, 7);

  it("keeps every section as it was with no query and nothing hidden", () => {
    expect(narrowSections(sections, "", new Set())).toEqual(sections);
  });

  it("searches across folded sections too, opening the ones that match", () => {
    const s = narrowSections(sections, "ecv3", new Set());
    expect(s.map((x) => [x.key, x.names, x.open])).toEqual([
      ["olderEc", ["ASDM7ECv3"], true],
      ["other", ["ASDM5ECv3"], true],
    ]);
  });

  it("matches without regard to case", () => {
    expect(narrowSections(sections, "AHM7EC8b", new Set()).flatMap((x) => x.names)).toEqual(["AHM7EC8B"]);
  });

  it("drops what's hidden (e.g. won't play here) and any section left empty", () => {
    const hide = new Set(["AHM5EC5L", "AHM7EC5L", "AHM5EC8B", "AHM7EC8B"]);
    expect(narrowSections(sections, "", hide).some((x) => x.key === "ahm")).toBe(false);
  });
});
