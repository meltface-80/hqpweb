import { describe, expect, it } from "vitest";
import { DAC_MODELS } from "./dac-models.ts";
import { CHIP_FAMILIES, isDated, type Advice } from "./dacs.ts";

describe("Find your DAC: which advice may be dated", () => {
  const at = (date: string, about: Advice["about"]): Advice => ({ text: "", url: "", date, about });

  it("marks modulator advice from before HQPlayer 5.11's modulators (Feb 2025)", () => {
    expect(isDated(at("2025-01", "modulator"))).toBe(true);
  });

  it("doesn't mark modulator advice from February 2025 on", () => {
    expect(isDated(at("2025-02", "modulator"))).toBe(false);
  });

  it("doesn't mark old advice about dither, or facts about the hardware", () => {
    expect([isDated(at("2016-01", "dither")), isDated(at("2016-01", "hardware"))]).toEqual([false, false]);
  });
});

const advice = [...CHIP_FAMILIES, ...DAC_MODELS].flatMap((r) => (r.advice ?? []).map((a) => ({ id: r.id, ...a })));

describe("Find your DAC: the table's own rules", () => {
  it("gives every row a unique id", () => {
    const ids = [...CHIP_FAMILIES, ...DAC_MODELS].map((r) => r.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("gives every model row at least one source", () => {
    expect(DAC_MODELS.filter((m) => m.sources.length === 0).map((m) => m.id)).toEqual([]);
  });

  it("gives every source a link, or a label saying what it is", () => {
    const bare = DAC_MODELS.filter((m) => m.sources.some((s) => !s.url && !s.label)).map((m) => m.id);
    expect(bare).toEqual([]);
  });

  it("marks every unlinked source as seen only in search results", () => {
    const wrong = DAC_MODELS.filter((m) => m.sources.some((s) => !s.url && s.seen !== "search")).map((m) => m.id);
    expect(wrong).toEqual([]);
  });

  it("cites Signalyst's advice as a single forum post, with its month", () => {
    const odd = advice.filter(
      (a) => !/^https:\/\/community\.roonlabs\.com\/t\/\d+\/\d+$/.test(a.url) || !/^\d{4}-\d\d$/.test(a.date),
    );
    expect(odd.map((a) => `${a.id}: ${a.url} ${a.date}`)).toEqual([]);
  });

  it("answers fifth order for ESS chips up to the ES9038 and ES9068, seventh from the ES9039", () => {
    const disagree = DAC_MODELS.filter((m) => {
      const ess = /ES90(\d\d)/.exec(m.chip)?.[1];
      if (!ess || m.dsd === "converts") return false;
      return ["18", "28", "38", "68"].includes(ess) !== (m.dsd === "older-ess");
    });
    expect(disagree.map((m) => `${m.id}: ${m.chip} → ${m.dsd}`)).toEqual([]);
  });

  it("never names an older-series modulator in advice, only the principle (order, rate, 512+fs)", () => {
    // ASDM7EC, ASDM7ECv2, ASDM7, DSD7 and the like, but not ASDM7EC-fast or DSD512.
    const older = /\b(ASDM[57](EC(v\d)?)?|DSD[57](v2)?)\b(?!-)/;
    expect(advice.filter((a) => older.test(a.text)).map((a) => `${a.id}: ${a.text}`)).toEqual([]);
  });

  it("says what every piece of advice is about", () => {
    const odd = advice.filter((a) => !["modulator", "dither", "hardware"].includes(a.about));
    expect(odd.map((a) => `${a.id}: ${String(a.about)}`)).toEqual([]);
  });

  it("never lists a model as both covered and excluded by the same row", () => {
    const both = DAC_MODELS.filter((m) => m.notThese?.some((n) => m.models.includes(n))).map((m) => m.id);
    expect(both).toEqual([]);
  });
});
