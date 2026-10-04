import { describe, expect, it } from "vitest";
import { ditherHint, filterSlot, modulatorHint, predictedStop, ratioClass, ratioHint } from "../src/compat.ts";

describe("ratio rules (manual §4.6)", () => {
  it("knows classes, including -2s variants, and admits unknown names", () => {
    expect(ratioClass("sinc-M")).toBe("pow2"); // measured on 5.17.2, not the manual's whole-number
    expect(ratioClass("FFT")).toBe("pow2");
    expect(ratioClass("closed-form-M")).toBe("pow2-up");
    expect(ratioClass("poly-sinc-long-lp-2s")).toBe("any");
    expect(ratioClass("poly-sinc-ext2-xla")).toBe("any"); // from HQPlayer 6's descriptions
    expect(ratioClass("some-future-filter")).toBeUndefined();
  });

  it("explains the measured sinc-M stop: 44.1k → 192k isn't a power-of-two ratio", () => {
    expect(ratioHint("sinc-M", 44_100, 192_000)).toMatchObject({
      level: "hard",
      text: expect.stringMatching(/power-of-two.*4\.35×/),
    });
    expect(ratioHint("sinc-M", 44_100, 176_400)).toBeUndefined(); // 4×
    expect(ratioHint("sinc-M", 192_000, 96_000)).toBeUndefined(); // 2× down plays (measured, 5.17.2)
    expect(ratioHint("sinc-M", 32_000, 96_000)?.level).toBe("hard"); // 3× refused (measured, 5.17.2)
    expect(ratioHint("sinc-M", 192_000, 96_000, false, "pow2-up")?.level).toBe("hard"); // HQPlayer 6 PCM
  });

  it("handles power-of-two and integer-up filters", () => {
    expect(ratioHint("closed-form", 44_100, 352_800)).toBeUndefined(); // 8×
    expect(ratioHint("closed-form", 44_100, 264_600)?.level).toBe("hard"); // 6×
    expect(ratioHint("polynomial-1", 96_000, 48_000)?.level).toBe("hard"); // down
    expect(ratioHint("poly-sinc-mqa/mp3-lp", 44_100, 22_579_200, true)).toBeUndefined(); // SDM: any
  });

  it("says nothing for 'any' filters or unknown names", () => {
    expect(ratioHint("poly-sinc-gauss-long", 44_100, 192_000)).toBeUndefined();
    expect(ratioHint("mystery-filter", 44_100, 192_000)).toBeUndefined();
  });

  it("puts sources below 50 kHz on the 1x filter", () => {
    expect(filterSlot(48_000)).toBe("1x");
    expect(filterSlot(88_200)).toBe("Nx");
  });
});

describe("modulator and dither hints (§4.5, §4.4)", () => {
  it("treats AHM below DSD1024 as hard (measured for AHM7EC8B)", () => {
    expect(modulatorHint("AHM7EC8B", 22_579_200)?.level).toBe("hard");
    expect(modulatorHint("AHM7EC8B", 45_158_400)).toBeUndefined();
    expect(modulatorHint("ASDM7EC-fast 512+fs", 11_289_600)?.level).toBe("soft");
    expect(modulatorHint("ASDM7EC", 2_822_400)).toBeUndefined();
  });

  it("gives soft dither guidance by rate", () => {
    expect(ditherHint("NS5", 96_000)?.level).toBe("soft");
    expect(ditherHint("NS5", 384_000)).toBeUndefined();
    expect(ditherHint("TPDF", 44_100)).toBeUndefined();
  });

  it("predicts stops only from hard rules", () => {
    expect(
      predictedStop({ mode: "PCM", filter: "sinc-M", shaper: "NS5", sourceRate: 44_100, outputRate: 192_000 }),
    ).toBeDefined();
    expect(
      predictedStop({ mode: "PCM", filter: "poly-sinc-gauss-long", shaper: "NS5", sourceRate: 44_100, outputRate: 96_000 }),
    ).toBeUndefined();
    expect(
      predictedStop({
        mode: "SDM (DSD)",
        filter: "poly-sinc-gauss-xla",
        shaper: "AHM7EC8B",
        sourceRate: 44_100,
        outputRate: 11_289_600,
      }),
    ).toBeDefined();
  });
});

describe("HQPlayer 6 descriptions", () => {
  it("parses filter descriptions as measured on engine 6.2.3", async () => {
    const { parseFilterDescription } = await import("../src/compat.ts");
    expect(parseFilterDescription("5/5 transients, timbre, space ⥮ Any")).toEqual({
      rating: 5,
      tags: ["transients", "timbre", "space"],
      ratio: "any",
      ratioText: "Any",
      arrow: "⥮",
    });
    expect(parseFilterDescription("4/5 space, ⥮ Any")?.tags).toEqual(["space"]); // trailing comma, measured
    expect(parseFilterDescription("2/5 ⥮ 2^x up")).toMatchObject({ rating: 2, tags: [], ratio: "pow2-up" });
    expect(parseFilterDescription("5/5 timbre ⥣ Any")?.arrow).toBe("⥣"); // SDM, in our capture
    expect(parseFilterDescription("1/5 ⥮ 1:1")?.ratio).toBe("1:1");
    expect(parseFilterDescription(undefined)).toBeUndefined();
    expect(parseFilterDescription("something new")).toBeUndefined();
    // Hostile input is rejected quickly (CodeQL: polynomial regex).
    const t0 = performance.now();
    expect(parseFilterDescription("9/5" + " ".repeat(150) + "x")).toBeUndefined();
    expect(parseFilterDescription("9/5" + " ".repeat(50_000))).toBeUndefined();
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("lets HQPlayer's own ratio rule override ours", async () => {
    const { ratioHint } = await import("../src/compat.ts");
    // Our table says any for poly-sinc-long-lp; a description saying "Int" wins.
    expect(ratioHint("poly-sinc-long-lp", 44_100, 192_000, false, "integer")?.level).toBe("hard");
    expect(ratioHint("poly-sinc-long-lp", 44_100, 192_000)).toBeUndefined();
  });

  it("reads modulator generations", async () => {
    const { modulatorGeneration } = await import("../src/compat.ts");
    expect(modulatorGeneration("Gen8")).toBe(8);
    expect(modulatorGeneration("")).toBeUndefined();
  });
});

describe("v5 instances (no descriptions of their own)", () => {
  it("borrow HQPlayer 6's rating and focus, but keep the v5 manual's ratio rule", async () => {
    const { filterNotes } = await import("../src/compat.ts");
    expect(filterNotes("sinc-M", undefined, false, false)).toEqual({
      rating: 4,
      tags: ["space", "timbre"],
      ratio: "pow2",
      ratioText: "2^x",
      fromHqp: false,
    });
    expect(filterNotes("poly-sinc-mqa/mp3-lp", undefined, true, false)?.ratio).toBe("any"); // SDM (§4.6)
    expect(filterNotes("poly-sinc-mqa/mp3-lp", undefined, false, false)?.ratio).toBe("integer-up");
  });

  it("describe v5-only filters from the manual, without a rating", async () => {
    const { filterNotes } = await import("../src/compat.ts");
    const ext3 = filterNotes("poly-sinc-ext3", undefined, false, false);
    expect(ext3).toMatchObject({ tags: ["timbre"], ratio: "any" });
    expect(ext3?.rating).toBeUndefined();
    expect(filterNotes("some-future-filter", undefined, false, false)).toBeUndefined();
  });

  it("never mix: an instance that describes its filters gets only its own words", async () => {
    const { filterNotes, modulatorGen } = await import("../src/compat.ts");
    expect(filterNotes("sinc-M", "4/5 space, timbre ⥮ 2^x up", false, true)).toMatchObject({ ratio: "pow2-up", fromHqp: true });
    expect(filterNotes("sinc-M", undefined, false, true)).toBeUndefined();
    expect(modulatorGen("AHM7EC8B", undefined, false)).toBe(8);
    expect(modulatorGen("AHM7EC8B", undefined, true)).toBeUndefined();
    expect(modulatorGen("AHM7EC5L", undefined, false)).toBeUndefined(); // v5-only
  });
});

describe("compatible rates for a filter", () => {
  it("lists the rates sinc-M can play from 44.1k, nearest to the current 192k first-class", async () => {
    const { compatibleRates } = await import("../src/compat.ts");
    const rates = [0, 44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800, 384_000];
    const r = compatibleRates({ filter: "sinc-M", sourceRate: 44_100, rates, sdm: false, shaper: "TPDF", currentRate: 192_000 });
    expect(r.map((x) => x.rate)).toEqual([44_100, 88_200, 176_400, 352_800]); // power-of-two (measured on 5.17.2)
    expect(r.find((x) => x.nearest)?.rate).toBe(176_400);
  });

  it("uses HQPlayer's own rule when given, and skips Auto", async () => {
    const { compatibleRates } = await import("../src/compat.ts");
    const rates = [0, 44_100, 88_200, 132_300];
    const up = compatibleRates({
      filter: "x",
      sourceRate: 88_200,
      rates,
      sdm: false,
      shaper: "",
      currentRate: 44_100,
      given: "pow2-up",
    });
    expect(up.map((x) => x.rate)).toEqual([88_200]); // no downsampling, no 1.5×
  });

  it("in SDM, also respects the modulator's rate floor", async () => {
    const { compatibleRates } = await import("../src/compat.ts");
    const rates = [5_644_800, 11_289_600, 22_579_200, 45_158_400];
    const r = compatibleRates({
      filter: "poly-sinc-gauss-xla",
      sourceRate: 44_100,
      rates,
      sdm: true,
      shaper: "AHM7EC8B",
      currentRate: 22_579_200,
    });
    expect(r.map((x) => x.rate)).toEqual([45_158_400]); // AHM needs ≥ 40.96 MHz
  });
});

describe("apodizing filters (HQPlayer 6's table)", () => {
  it("knows yes, no and partly; -2s follows its base; unknown names stay unknown", async () => {
    const { isApodizing } = await import("../src/compat.ts");
    expect(isApodizing("poly-sinc-gauss-xla")).toBe(true);
    expect(isApodizing("poly-sinc-gauss-xl")).toBe(false);
    expect(isApodizing("poly-sinc-ext2-xla")).toBe(true); // v6-only, now known
    expect(isApodizing("poly-sinc-lp")).toBe("partial");
    expect(isApodizing("poly-sinc-xtr-short-lp-2s")).toBe(true);
    expect(isApodizing("some-future-filter")).toBeUndefined();
  });
});
