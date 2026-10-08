import { describe, expect, it } from "vitest";
import { autoNote, healthWord, otherMode, pathSteps, seenWhen } from "./signal.ts";

const PCM_RATES = [44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800, 384_000, 705_600, 768_000];
const DSD_RATES = [2_822_400, 5_644_800, 11_289_600, 22_579_200, 45_158_400];

describe("the path line", () => {
  it("reads source → filter → shaping → output → DAC, with short filter names", () => {
    expect(
      pathSteps({
        source: 44_100,
        filter: "poly-sinc-gauss-xla",
        shaper: "ASDM7EC-super",
        outRate: 11_289_600,
        modeName: "SDM (DSD)",
        dac: "Holo",
      }),
    ).toEqual(["44.1k", "gauss-xla", "ASDM7EC-super", "DSD256", "Holo"]);
  });
  it("shows a DSD rate as DSD even while the mode reads PCM (just after a switch)", () => {
    expect(pathSteps({ source: 44_100, filter: "sinc-M", shaper: "NS5", outRate: 45_158_400, modeName: "PCM" })).toContain(
      "DSD1024",
    );
  });
  it("puts a word with the health dot", () => {
    expect([healthWord("ok", true), healthWord("warn", true), healthWord("bad", true), healthWord("", false)]).toEqual([
      "keeping up",
      "straining",
      "falling behind",
      "not playing",
    ]);
  });
  it("leaves out what isn't known (nothing playing, no DAC name)", () => {
    expect(pathSteps({ source: 0, filter: "sinc-M", shaper: "NS9", outRate: 0, modeName: "PCM" })).toEqual(["sinc-M", "NS9"]);
  });
});

describe("what auto picked, and why (measured 2026-10-08 on Desktop 5.35.10)", () => {
  it("PCM: a power-of-two filter gets the highest rate it can use from this source", () => {
    const n = autoNote({
      sdm: false,
      auto: true,
      outRate: 705_600,
      filter: "sinc-M",
      source: 44_100,
      shaper: "NS9",
      rates: PCM_RATES,
    });
    expect(n).toMatchObject({ warn: false });
    expect(n!.text).toMatch(/705\.6 kHz/);
    expect(n!.why).toMatch(/sinc-M.*power-of-two/);
  });
  it("PCM: a filter that takes any ratio gets the highest rate offered", () => {
    const n = autoNote({
      sdm: false,
      auto: true,
      outRate: 768_000,
      filter: "poly-sinc-gauss-xla",
      source: 44_100,
      shaper: "NS9",
      rates: PCM_RATES,
    });
    expect(n!.why).toMatch(/any ratio|highest/i);
    expect(n!.warn).toBe(false);
  });
  it("DSD: says auto is always the highest, and flags it when that rate has failed here", () => {
    const calm = autoNote({
      sdm: true,
      auto: true,
      outRate: 45_158_400,
      filter: "poly-sinc-gauss-xla",
      source: 44_100,
      shaper: "AHM7EC8B",
      rates: DSD_RATES,
    });
    expect(calm!.why).toMatch(/always the highest/);
    expect(calm!.warn).toBe(false);
    const bad = autoNote({
      sdm: true,
      auto: true,
      outRate: 45_158_400,
      filter: "poly-sinc-gauss-xla",
      source: 44_100,
      shaper: "ASDM7EC-super",
      rates: DSD_RATES,
      failedHere: 2,
    });
    expect(bad).toMatchObject({ warn: true });
    expect(bad!.why).toMatch(/fell behind here.*twice/);
    expect(bad!.fixed).toEqual([22_579_200, 11_289_600]);
  });
  it("says nothing for a fixed rate, and says auto when nothing plays yet", () => {
    expect(
      autoNote({ sdm: false, auto: false, outRate: 384_000, filter: "x", source: 44_100, shaper: "NS5", rates: PCM_RATES }),
    ).toBeNull();
    expect(autoNote({ sdm: false, auto: true, outRate: 0, filter: "x", source: 0, shaper: "NS5", rates: PCM_RATES })!.text).toBe(
      "Auto",
    );
  });
});

describe("the other mode's tab", () => {
  const modes = (...names: string[]) => names.map((name, index) => ({ index, name, value: 0 }));
  it("offers DSD from PCM when HQPlayer has it, and greys it when it doesn't", () => {
    expect(otherMode(modes("[source]", "PCM", "SDM (DSD)"), "PCM")).toEqual({ label: "DSD", name: "SDM (DSD)", offered: true });
    expect(otherMode(modes("[source]", "PCM"), "PCM")).toEqual({ label: "DSD", name: null, offered: false });
    expect(otherMode(modes("[source]", "PCM", "SDM (DSD)"), "SDM (DSD)")).toEqual({ label: "PCM", name: "PCM", offered: true });
  });
  it("says when its settings were last seen, briefly", () => {
    const now = new Date("2026-10-08T15:00:00");
    expect(seenWhen("2026-10-08T13:42:00", now)).toMatch(/^today /);
    expect(seenWhen("2026-10-06T13:42:00", now)).toMatch(/^[A-Z][a-z]{2} /);
  });
});
