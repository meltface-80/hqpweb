import { describe, expect, it } from "vitest";
import { MODULATORS_V5 as V5, MODULATORS_V61 as V61 } from "./recorded-lists.ts";
import { modulatorPairs } from "./pairs.ts";

const ALL = [0, 2_822_400, 5_644_800, 11_289_600, 22_579_200, 45_158_400];
const pairs = (setup: Parameters<typeof modulatorPairs>[0]["setup"], o: { rates?: number[]; modulators?: string[] } = {}) =>
  modulatorPairs({ setup, rates: o.rates ?? ALL, modulators: o.modulators ?? V61 });
const brief = (p: ReturnType<typeof pairs>) => p.map((x) => [x.label, x.start.name, x.suitsDac]);

describe("rate and modulator pairs for the guide", () => {
  it("gives a direct-DSD DAC DSD256 with the default and DSD1024 with AHM first, then DSD512", () => {
    expect(brief(pairs({ dsd: "direct" }))).toEqual([
      ["DSD256", "ASDM7EC-fast", true],
      ["DSD1024", "AHM7EC4B", true],
      ["DSD512", "ASDM7EC-fast", false],
    ]);
  });

  it("gives an older ESS DAC DSD512 first, fifth order throughout", () => {
    expect(brief(pairs({ dsd: "older-ess" }))).toEqual([
      ["DSD512", "ASDM5EC-fast", true],
      ["DSD256", "ASDM5EC-fast", false],
      ["DSD1024", "AHM5EC4B", false],
    ]);
  });

  it("adds DSD512 for a direct DAC with a class-D or tube amplifier", () => {
    expect(pairs({ dsd: "direct", amp: "class-d-or-tube" }).find((p) => p.label === "DSD512")?.suitsDac).toBe(true);
  });

  it("pairs DSD512 with plain -fast even when HQPlayer sets the volume (512+fs is an option)", () => {
    expect(pairs({ dsd: "direct", volume: "hqplayer" }).find((p) => p.label === "DSD512")?.start.name).toBe("ASDM7EC-fast");
  });

  it("offers DSD1024 only with an AHM modulator HQPlayer lists", () => {
    const noAhm = V5.filter((n) => !n.startsWith("AHM"));
    expect(pairs({ dsd: "direct" }, { modulators: noAhm }).map((p) => p.label)).toEqual(["DSD256", "DSD512"]);
  });

  it("offers only rates HQPlayer lists", () => {
    expect(pairs({ dsd: "direct" }, { rates: [0, 11_289_600] }).map((p) => p.label)).toEqual(["DSD256"]);
  });

  it("offers nothing until the DAC question is answered", () => {
    expect(pairs({})).toEqual([]);
  });

  it("still offers pairs when the DAC suits PCM, none of them marked as suiting it", () => {
    const p = pairs({ dsd: "converts" });
    expect([p.length > 0, p.some((x) => x.suitsDac)]).toEqual([true, false]);
  });

  it("gives each pair its rate in Hz, to apply as one change", () => {
    expect(pairs({ dsd: "direct" })[0]).toMatchObject({ rateHz: 11_289_600 });
  });
});
