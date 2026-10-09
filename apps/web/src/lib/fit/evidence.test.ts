import { describe, expect, it } from "vitest";
import type { Combo, Failure, KeptUp } from "../api.ts";
import { loadEvidence } from "./evidence.ts";

/** Records dated relative to now, so the 90-day ageing (evidence.ts) never dates these tests. */
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const DSD128 = 5_644_800;
const DSD256 = 11_289_600;
const CD = 44_100;
const combo = (o: Partial<Combo> = {}): Combo => ({
  mode: "SDM",
  rateHz: DSD256,
  filter1x: "sinc-L",
  filterNx: "poly-sinc-gauss-hires-lp",
  shaper: "ASDM7EC-super",
  ...o,
});
const failure = (o: Partial<Failure> = {}): Failure => ({
  ...combo(),
  reason: "stopped",
  at: daysAgo(3),
  sourceRates: [CD],
  ...o,
});
const kept = (o: Partial<KeptUp> = {}): KeptUp => ({
  ...combo(),
  sourceRate: CD,
  low: 1.4,
  typical: 1.6,
  sessions: 1,
  first: daysAgo(2),
  at: daysAgo(2),
  ...o,
});

describe("load evidence", () => {
  it("reports what was measured for this exact combination, latest first", () => {
    expect(loadEvidence(combo(), CD, [failure()], []).kind).toBe("failed");
    expect(loadEvidence(combo(), CD, [], [kept()]).kind).toBe("kept");
    expect(loadEvidence(combo(), CD, [], [kept({ low: 0.87 })]).kind).toBe("slow");
    expect(loadEvidence(combo(), CD, [failure()], [kept()]).kind).toBe("kept");
    expect(loadEvidence(combo(), CD, [failure({ at: daysAgo(1) })], [kept()]).kind).toBe("failed");
  });

  it("infers trouble from something no heavier that failed: sinc-Lh failed, so sinc-L probably will", () => {
    const e = loadEvidence(combo({ filter1x: "sinc-L" }), CD, [failure({ filter1x: "sinc-Lh" })], []);
    expect(e).toMatchObject({ kind: "likely-fails", steps: [{ basis: { says: expect.stringMatching(/eighth/) } }] });
  });

  it("doesn't infer the wrong way: sinc-L failing says nothing about the lighter sinc-Lh", () => {
    expect(loadEvidence(combo({ filter1x: "sinc-Lh" }), CD, [failure({ filter1x: "sinc-L" })], []).kind).toBe("none");
  });

  it("treats a slow run as trouble for anything no lighter", () => {
    const e = loadEvidence(combo({ filter1x: "sinc-L" }), CD, [], [kept({ filter1x: "sinc-Lh", low: 0.9 })]);
    expect(e.kind).toBe("likely-fails");
  });

  it("infers it'll keep up from something no lighter that did, including at a higher rate", () => {
    const k = kept({ filter1x: "poly-sinc-gauss-long" });
    expect(loadEvidence(combo({ filter1x: "poly-sinc-ext2-long" }), CD, [], [k]).kind).toBe("likely-keeps");
    expect(loadEvidence(combo({ filter1x: "poly-sinc-ext2-long", rateHz: DSD128 }), CD, [], [k]).kind).toBe("likely-keeps");
    expect(loadEvidence(combo({ filter1x: "poly-sinc-gauss-xla" }), CD, [], [k]).kind).toBe("none");
  });

  it("says the evidence disagrees when it does", () => {
    const e = loadEvidence(
      combo({ filter1x: "sinc-Ll" }),
      CD,
      [failure({ filter1x: "sinc-Lm" })],
      [kept({ filter1x: "sinc-L" })],
    );
    expect(e.kind).toBe("mixed");
  });

  it("ignores records older than the setting, its own and inferred, and keeps everything for never", () => {
    const old = failure({ filter1x: "sinc-Lh", at: daysAgo(91) });
    expect(loadEvidence(combo({ filter1x: "sinc-L" }), CD, [old], []).kind).toBe("none");
    expect(loadEvidence(combo({ filter1x: "sinc-Lh" }), CD, [old], []).kind).toBe("none");
    expect(loadEvidence(combo({ filter1x: "sinc-L" }), CD, [{ ...old, at: daysAgo(89) }], []).kind).toBe("likely-fails");
    const slow = kept({ filter1x: "sinc-Lh", low: 0.9, at: daysAgo(91) });
    expect(loadEvidence(combo({ filter1x: "sinc-L" }), CD, [], [slow]).kind).toBe("none");
    expect(loadEvidence(combo({ filter1x: "sinc-Lh" }), CD, [old], [], 365).kind).toBe("failed");
    expect(
      loadEvidence(combo({ filter1x: "sinc-Lh" }), CD, [failure({ at: daysAgo(3000), filter1x: "sinc-Lh" })], [], null).kind,
    ).toBe("failed");
    expect(loadEvidence(combo({ filter1x: "sinc-Lh" }), CD, [failure({ at: daysAgo(8), filter1x: "sinc-Lh" })], [], 7).kind).toBe(
      "none",
    );
  });

  it("only infers within one source rate, and not from failures without one", () => {
    const f = failure({ filter1x: "sinc-Lh" });
    expect(loadEvidence(combo(), 48_000, [f], []).kind).toBe("none");
    const old: Failure = { ...f, sourceRates: undefined };
    expect(loadEvidence(combo(), CD, [old], []).kind).toBe("none");
  });

  it("looks at the filter the source uses: the Nx slot for hi-res", () => {
    const f = failure({ filterNx: "sinc-Lh", sourceRates: [96_000] });
    expect(loadEvidence(combo({ filterNx: "sinc-L" }), 96_000, [f], []).kind).toBe("likely-fails");
    expect(loadEvidence(combo({ filterNx: "sinc-L" }), CD, [f], []).kind).toBe("none");
  });
});
