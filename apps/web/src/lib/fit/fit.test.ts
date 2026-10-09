import { describe, expect, it } from "vitest";
import type { Combo, Failure, KeptUp } from "../api.ts";
import { fit, nearestFits, type FitInput, type Pin } from "./fit.ts";

/** Records dated relative to now, so the 90-day ageing (evidence.ts) never dates these tests. */
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const DSD128 = 5_644_800;
const DSD256 = 11_289_600;
const DSD256_48 = 12_288_000;
const DSD512 = 22_579_200;
const CD = 44_100;
const RATES = [2_822_400, DSD128, DSD256, DSD256_48, DSD512];
const SHAPERS = ["ASDM7EC-ul", "ASDM7EC-light", "ASDM7EC-fast", "ASDM7EC-super", "AHM7EC8B"];
const FILTERS = ["sinc-L", "sinc-Lh", "sinc-M", "poly-sinc-gauss-long", "poly-sinc-ext2-long"];

const combo = (o: Partial<Combo> = {}): Combo => ({
  mode: "SDM",
  rateHz: DSD256,
  filter1x: "sinc-L",
  filterNx: "poly-sinc-gauss-hires-lp",
  shaper: "ASDM7EC-super",
  ...o,
});
const input = (o: Partial<Combo> = {}, sourceRate = CD): FitInput => ({ combo: combo(o), sourceRate, sdm: true });
const failure = (o: Partial<Combo> = {}): Failure => ({
  ...combo(o),
  reason: "stopped",
  at: daysAgo(3),
  sourceRates: [CD],
});
const kept = (o: Partial<Combo> = {}, low = 1.5): KeptUp => ({
  ...combo(o),
  sourceRate: CD,
  low,
  typical: low,
  sessions: 1,
  first: daysAgo(2),
  at: daysAgo(2),
});
const none = new Set<Pin>();

describe("fit", () => {
  it("won't, by a hard rule: a power-of-two filter from 48k to a 44.1k-family rate; AHM below DSD1024", () => {
    const f = fit(input({ filter1x: "sinc-M" }, 48_000), [], []);
    expect(f.verdict).toBe("wont");
    expect(f.rules[0]?.text).toMatch(/power-of-two/);
    expect(fit(input({ shaper: "AHM7EC8B" }), [], []).verdict).toBe("wont");
  });

  it("won't, when it failed here; doubtful when something no heavier did", () => {
    expect(fit(input(), [failure()], []).verdict).toBe("wont");
    expect(fit(input(), [failure({ filter1x: "sinc-Lh" })], []).verdict).toBe("doubtful");
  });

  it("fits when it or something no lighter kept up; otherwise only trying tells", () => {
    expect(fit(input(), [], [kept()]).verdict).toBe("fits");
    expect(fit(input({ filter1x: "sinc-Lh" }), [], [kept()]).verdict).toBe("fits");
    expect(fit(input({ filter1x: "poly-sinc-gauss-long" }), [], [kept()]).verdict).toBe("try");
  });

  it("skips the ratio rule when the rate is Auto: HQPlayer picks one that fits", () => {
    expect(fit({ ...input({ filter1x: "sinc-M" }, 48_000), ratioFixed: false }, [], []).verdict).toBe("try");
  });

  it("keeps soft rules as notes, not a verdict", () => {
    const f = fit(input({ shaper: "ASDM7EC-super 512+fs" }), [], []);
    expect(f.verdict).toBe("try");
    expect(f.rules[0]?.level).toBe("soft");
  });
});

describe("nearest fits", () => {
  const opts = { filters: FILTERS, shapers: SHAPERS, rates: RATES };

  it("with the filter pinned, never changes the filter, and starts with single lighter changes", () => {
    const s = nearestFits(input(), new Set<Pin>(["filter"]), opts, [failure()], []);
    expect(s).toHaveLength(3);
    expect(s.every((x) => x.change.filter === undefined && x.combo.filter1x === "sinc-L")).toBe(true);
    expect(s.every((x) => Object.keys(x.change).length === 1 && x.lighter)).toBe(true);
  });

  it("puts a change measured to keep up first", () => {
    const s = nearestFits(input(), new Set<Pin>(["filter"]), opts, [failure()], [kept({ rateHz: DSD128 })]);
    expect(s[0]?.change).toEqual({ rateHz: DSD128 });
    expect(s[0]?.fit.verdict).toBe("fits");
  });

  it("finds the rate that fixes a ratio: sinc-M from 48k goes to the 48k-family DSD256", () => {
    const s = nearestFits(input({ filter1x: "sinc-M" }, 48_000), new Set<Pin>(["filter", "shaper"]), opts, [], []);
    expect(s[0]?.change).toEqual({ rateHz: DSD256_48 });
  });

  it("never suggests what won't run or is doubtful, and respects every pin", () => {
    const s = nearestFits(
      input(),
      new Set<Pin>(["filter", "rateHz"]),
      opts,
      [failure(), failure({ shaper: "ASDM7EC-fast" })],
      [],
    );
    expect(s.every((x) => x.combo.rateHz === DSD256)).toBe(true);
    expect(s.map((x) => x.change.shaper)).not.toContain("ASDM7EC-fast");
    expect(s.map((x) => x.change.shaper)).not.toContain("AHM7EC8B");
    expect(s.every((x) => x.fit.verdict === "try" || x.fit.verdict === "fits")).toBe(true);
  });

  it("checks the ratio again for a rate it suggests, even from Auto", () => {
    const s = nearestFits(
      { ...input({ filter1x: "sinc-M" }, 48_000), ratioFixed: false },
      new Set<Pin>(["filter", "shaper"]),
      opts,
      [],
      [],
    );
    expect(s.map((x) => x.change.rateHz)).not.toContain(DSD128);
    expect(s[0]?.change).toEqual({ rateHz: DSD256_48 });
  });

  it("tries two changes only when one won't do", () => {
    const s = nearestFits(input(), none, { filters: ["sinc-L"], shapers: ["ASDM7EC-super"], rates: [DSD256] }, [failure()], []);
    expect(s).toEqual([]);
    const two = nearestFits(
      input(),
      new Set<Pin>(["filter"]),
      { ...opts, shapers: ["ASDM7EC-super", "ASDM7EC-light"], rates: [DSD128, DSD256] },
      [failure(), failure({ shaper: "ASDM7EC-light" }), failure({ rateHz: DSD128 })],
      [],
    );
    expect(two[0]?.change).toEqual({ shaper: "ASDM7EC-light", rateHz: DSD128 });
    // light at DSD256 failed, so light at a higher rate is doubtful, never suggested.
    const up = nearestFits(
      input(),
      new Set<Pin>(["filter"]),
      { ...opts, shapers: ["ASDM7EC-super", "ASDM7EC-light"], rates: [DSD256, DSD512] },
      [failure(), failure({ shaper: "ASDM7EC-light" }), failure({ rateHz: DSD512 })],
      [],
    );
    expect(up).toEqual([]);
  });
});
