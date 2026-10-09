import { describe, expect, it } from "vitest";
import { filterNoHeavier, runNoHeavier, shaperNoHeavier, type Run } from "./order.ts";

const says = (steps: { basis: { says: string } }[] | undefined) => steps?.map((s) => s.basis.says).join(" / ");

describe("no heavier than", () => {
  it("knows sinc-Lh is lighter than sinc-L, as stated, and not the other way round", () => {
    const steps = filterNoHeavier("sinc-Lh", "sinc-L");
    expect(says(steps)).toMatch(/eighth of sinc-L's load/);
    expect(steps?.every((s) => !s.basis.inferred)).toBe(true);
    expect(filterNoHeavier("sinc-L", "sinc-Lh")).toBeUndefined();
  });

  it("chains sinc-L family tap counts, marked inferred", () => {
    const steps = filterNoHeavier("sinc-Ls", "sinc-L");
    expect(steps?.length).toBeGreaterThan(1);
    expect(steps?.some((s) => s.basis.inferred)).toBe(true);
  });

  it("leaves pairs it has no word on unknown", () => {
    expect(filterNoHeavier("sinc-Lm", "sinc-Lh")).toBeUndefined();
    expect(filterNoHeavier("sinc-Lh", "sinc-Lm")).toBeUndefined();
    expect(filterNoHeavier("poly-sinc-gauss-long", "poly-sinc-gauss-xla")).toBeUndefined();
    expect(filterNoHeavier("poly-sinc-gauss-long", "sinc-M")).toBeUndefined();
  });

  it("puts a -2s filter at or below its base, and only that way", () => {
    expect(says(filterNoHeavier("poly-sinc-xtr-short-mp-2s", "poly-sinc-xtr-short-mp"))).toMatch(/two-stage/);
    expect(filterNoHeavier("poly-sinc-xtr-short-mp", "poly-sinc-xtr-short-mp-2s")).toBeUndefined();
  });

  it("treats Jussi's same-CPU pairs as equal both ways, and chains through them", () => {
    expect(says(filterNoHeavier("poly-sinc-ext2-long", "poly-sinc-gauss-long"))).toMatch(/about the same CPU/);
    expect(says(filterNoHeavier("poly-sinc-gauss-long", "poly-sinc-ext2-long"))).toMatch(/about the same CPU/);
    expect(filterNoHeavier("poly-sinc-gauss-long", "poly-sinc-ext2-xla")?.length).toBe(2);
  });

  it("orders EC variants within one modulator and suffix only", () => {
    expect(shaperNoHeavier("ASDM7EC-ul", "ASDM7EC-super")?.length).toBe(3);
    expect(shaperNoHeavier("ASDM7EC-super", "ASDM7EC-light")).toBeUndefined();
    expect(shaperNoHeavier("ASDM7EC-light 512+fs", "ASDM7EC-fast 512+fs")?.length).toBe(1);
    expect(shaperNoHeavier("ASDM7EC-light", "ASDM7EC-fast 512+fs")).toBeUndefined();
    expect(shaperNoHeavier("ASDM5EC-light", "ASDM7EC-fast")).toBeUndefined();
  });

  it("compares runs only from the same source in the same mode, and a lower rate is lighter", () => {
    const run = (o: Partial<Run>): Run => ({
      mode: "SDM",
      rateHz: 11_289_600,
      filter: "sinc-L",
      shaper: "ASDM7EC-super",
      sourceRate: 44_100,
      ...o,
    });
    expect(says(runNoHeavier(run({ filter: "sinc-Lh", rateHz: 5_644_800 }), run({})))).toMatch(/eighth.*lower output rate/);
    expect(runNoHeavier(run({ rateHz: 22_579_200 }), run({}))).toBeUndefined();
    expect(runNoHeavier(run({ sourceRate: 48_000 }), run({}))).toBeUndefined();
    expect(runNoHeavier(run({ mode: "PCM" }), run({}))).toBeUndefined();
    expect(runNoHeavier(run({}), run({}))).toEqual([]);
  });
});
