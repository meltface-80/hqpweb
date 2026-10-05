import { describe, expect, it } from "vitest";
import { compare, type Named } from "../settings.ts";

const start: Named = {
  mode: "PCM",
  rate: 0,
  filter1x: "poly-sinc-gauss-xl",
  filterNx: "poly-sinc-gauss-hires-lp",
  shaper: "NS5",
  invert: false,
  filter20k: false,
  adaptive: false,
  convolution: false,
  matrixProfile: "",
  volume: -36,
};

describe("release check: comparing the end state with the snapshot", () => {
  it("passes when everything came back", () => {
    expect(compare(start, { ...start })).toEqual({ differs: [] });
  });

  it("names each setting that didn't come back", () => {
    const r = compare(start, { ...start, rate: 176_400, filter1x: "sinc-M" });
    expect(r.differs).toEqual(["rate: 0 → 176400", "filter1x: poly-sinc-gauss-xl → sinc-M"]);
  });

  it("accepts a lower volume, and says so", () => {
    const r = compare(start, { ...start, volume: -42 });
    expect(r.differs).toEqual([]);
    expect(r.volumeNote).toContain("6.0 dB below");
  });

  it("fails a volume higher than at the start, by any amount past read-back noise", () => {
    expect(compare(start, { ...start, volume: -35.5 }).differs).toEqual(["volume: -36 → -35.5 dB (higher than at the start)"]);
  });

  it("ignores read-back noise in the volume", () => {
    expect(compare(start, { ...start, volume: -36.005 })).toEqual({ differs: [] });
  });
});
