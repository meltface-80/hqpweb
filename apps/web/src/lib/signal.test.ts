import { describe, expect, it } from "vitest";
import { autoNote, healthWord, otherMode, pathSteps, rateInMode, seenWhen, switchPlan } from "./signal.ts";

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
    ).toEqual(["44.1 kHz", "gauss-xla", "ASDM7EC-super", "DSD256", "Holo"]);
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

describe("switching mode: what the rate will be", () => {
  it("goes back to the mode's last fixed rate", () => {
    expect(switchPlan("DSD", 11_289_600)).toEqual({ rate: 11_289_600, ask: false });
  });
  it("asks for a DSD rate when none is known (auto would be the highest), not for PCM", () => {
    expect(switchPlan("DSD", undefined)).toEqual({ rate: null, ask: true });
    expect(switchPlan("DSD", 0)).toEqual({ rate: null, ask: true });
    expect(switchPlan("PCM", undefined)).toEqual({ rate: null, ask: false });
  });
});

// Seen on the owner's test build (2026-10-08): switched to DSD while paused, HQPlayer still reported
// PCM's last rate (768k) until playback started, and the card showed it as DSD's.
describe("a rate only counts in its own mode", () => {
  it("drops a PCM rate reported while in DSD, and a DSD rate while in PCM", () => {
    expect(rateInMode(768_000, "SDM (DSD)")).toBe(0);
    expect(rateInMode(45_158_400, "PCM")).toBe(0);
    expect(rateInMode(11_289_600, "SDM (DSD)")).toBe(11_289_600);
    expect(rateInMode(705_600, "PCM")).toBe(705_600);
  });
});

describe("rates around a mode switch (pre-release review)", () => {
  it("counts 48k-family DSD as DSD, and leaves [source] readings alone", async () => {
    const { rateInMode } = await import("./signal.ts");
    expect(rateInMode(12_288_000, "SDM (DSD)")).toBe(12_288_000);
    expect(rateInMode(12_288_000, "PCM")).toBe(0);
    expect(rateInMode(705_600, "SDM (DSD)")).toBe(0);
    expect(rateInMode(11_289_600, "[source]")).toBe(11_289_600);
  });
  it("proposes only DSD rates the mode allows, and doesn't promise a remembered one it doesn't", async () => {
    const { dsdChoices, switchPlan, DSD_CHOICES } = await import("./signal.ts");
    const lists = {
      rates: [
        { rate: 5_644_800, allowed: true },
        { rate: 11_289_600, allowed: false },
        { rate: 22_579_200, allowed: false },
      ],
    };
    expect(dsdChoices(undefined)).toEqual(DSD_CHOICES);
    expect(dsdChoices(lists)).toEqual([]);
    const offered = (hz: number) => lists.rates.some((r) => r.rate === hz && r.allowed);
    expect(switchPlan("DSD", 11_289_600, offered)).toEqual({ rate: null, ask: true });
    expect(switchPlan("DSD", 5_644_800, offered)).toEqual({ rate: 5_644_800, ask: false });
  });
});
