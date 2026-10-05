import { describe, expect, it } from "vitest";
import { DAC_MODELS } from "./dac-models.ts";
import { CHIP_FAMILIES } from "./dacs.ts";

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

  it("never lists a model as both covered and excluded by the same row", () => {
    const both = DAC_MODELS.filter((m) => m.notThese?.some((n) => m.models.includes(n))).map((m) => m.id);
    expect(both).toEqual([]);
  });
});
