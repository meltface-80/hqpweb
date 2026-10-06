import { describe, expect, it } from "vitest";
import { MODULATORS_V5 as V5, MODULATORS_V61 as V61 } from "./recorded-lists.ts";
import { modulatorAdvice, type ModulatorInput } from "./modulator.ts";
import { RULES } from "./policy.ts";

const DSD256 = 11_289_600,
  DSD512 = 22_579_200,
  DSD1024 = 45_158_400;
const advise = (over: Partial<ModulatorInput> & { setup: ModulatorInput["setup"] }) =>
  modulatorAdvice({ rateHz: DSD256, modulators: V5, ...over });

describe("modulator advice: the DAC question", () => {
  it("gives no advice until the DSD question is answered", () => {
    expect(advise({ setup: {} }).status).toBe("needs-dac");
  });

  it("starts a direct-DSD DAC on HQPlayer's default, ASDM7EC-fast, citing why the default", () => {
    expect(advise({ setup: { dsd: "direct" } }).start).toEqual({
      name: "ASDM7EC-fast",
      isDefault: true,
      rules: [RULES.default],
    });
  });

  it("starts an older ESS DAC on fifth order, citing the rule", () => {
    expect(advise({ setup: { dsd: "older-ess" } }).start).toEqual({
      name: "ASDM5EC-fast",
      isDefault: false,
      rules: [RULES.olderEssFifth],
    });
  });

  it("suggests DSD512 for ESS chips, old and new", () => {
    const rates = (["older-ess", "remodulates"] as const).map((dsd) => advise({ setup: { dsd } }).suggestedRate?.label);
    expect(rates).toEqual(["DSD512", "DSD512"]);
  });

  it("suggests DSD256, or DSD1024 with AHM, for a direct-DSD DAC", () => {
    expect(advise({ setup: { dsd: "direct" } }).suggestedRate).toEqual({
      label: "DSD256",
      orDsd1024: true,
      orDsd512: false,
      rules: [RULES.rateDirect],
    });
  });

  it("adds DSD512 for a direct-DSD DAC with a class-D or tube amplifier, to cut ultrasonic noise", () => {
    expect(advise({ setup: { dsd: "direct", amp: "class-d-or-tube" } }).suggestedRate).toMatchObject({
      orDsd512: true,
      rules: [RULES.rateDirect, RULES.ampRate],
    });
  });

  it("warns that the AK4191 pair, which also re-processes DSD, does better below DSD512", () => {
    expect(advise({ setup: { dsd: "remodulates" } }).suggestedRate?.rules).toEqual([RULES.rateEss, RULES.akmPairRate]);
  });

  it("sends a DAC that converts DSD to PCM, with no modulator to start on", () => {
    const a = advise({ setup: { dsd: "converts" } });
    expect([a.status, a.start]).toEqual(["use-pcm", null]);
  });
});

describe("modulator advice: amplifier and volume", () => {
  it("moves to fifth order with a class-D or tube amplifier, citing the rule", () => {
    expect(advise({ setup: { dsd: "direct", amp: "class-d-or-tube" } }).start).toMatchObject({
      name: "ASDM5EC-fast",
      rules: [RULES.ampFifth],
    });
  });

  it("leaves the order alone when the listener isn't sure about the amplifier", () => {
    expect(advise({ setup: { dsd: "direct", amp: "unsure" } }).order).toBe(7);
  });

  it("suggests 512+fs when HQPlayer sets the volume, at DSD512", () => {
    expect(advise({ setup: { dsd: "direct", volume: "hqplayer" }, rateHz: DSD512 }).start).toMatchObject({
      name: "ASDM7EC-fast 512+fs",
      rules: [RULES.p512Volume],
    });
  });

  it("offers the plain version first, since 512+fs is an option, not an upgrade", () => {
    const a = advise({ setup: { dsd: "direct", volume: "hqplayer" }, rateHz: DSD512 });
    expect(a.alternatives.map((x) => x.name)).toEqual([
      "ASDM7EC-fast",
      "ASDM7EC-ul 512+fs",
      "ASDM7EC-light 512+fs",
      "ASDM7EC-super 512+fs",
    ]);
  });

  it("doesn't suggest 512+fs at DSD256, even when HQPlayer sets the volume", () => {
    expect(advise({ setup: { dsd: "direct", volume: "hqplayer" } }).start?.name).toBe("ASDM7EC-fast");
  });

  it("doesn't suggest 512+fs when the volume is fixed", () => {
    expect(advise({ setup: { dsd: "direct", volume: "fixed" }, rateHz: DSD512 }).start?.name).toBe("ASDM7EC-fast");
  });
});

describe("modulator advice: DSD1024 and names", () => {
  it("starts on AHM7EC8B at DSD1024 on HQPlayer 5", () => {
    expect(advise({ setup: { dsd: "direct" }, rateHz: DSD1024 }).start).toMatchObject({
      name: "AHM7EC8B",
      rules: [RULES.dsd1024Ahm],
    });
  });

  it("prefers the 4B AHM when HQPlayer lists it (6.1), citing why", () => {
    expect(advise({ setup: { dsd: "direct" }, rateHz: DSD1024, modulators: V61 }).start).toMatchObject({
      name: "AHM7EC4B",
      rules: [RULES.dsd1024Ahm, RULES.ahm4b],
    });
  });

  it("uses fifth-order AHM with a class-D or tube amplifier", () => {
    expect(advise({ setup: { dsd: "direct", amp: "class-d-or-tube" }, rateHz: DSD1024, modulators: V61 }).start?.name).toBe(
      "AHM5EC4B",
    );
  });

  it("treats the 48k-family DSD1024 rate as DSD1024", () => {
    expect(advise({ setup: { dsd: "direct" }, rateHz: 49_152_000 }).start?.name).toBe("AHM7EC8B");
  });

  it("falls back to the EC line at DSD1024 if no AHM is listed", () => {
    const noAhm = V5.filter((n) => !n.startsWith("AHM"));
    expect(advise({ setup: { dsd: "direct" }, rateHz: DSD1024, modulators: noAhm }).start?.name).toBe("ASDM7EC-fast");
  });

  it("starts on nothing rather than a name HQPlayer doesn't list", () => {
    expect(advise({ setup: { dsd: "direct" }, modulators: ["DSD5", "DSD7"] }).start).toBeNull();
  });

  it("offers the rest of the family, lightest first, as alternatives", () => {
    expect(advise({ setup: { dsd: "direct" } }).alternatives.map((x) => x.name)).toEqual([
      "ASDM7EC-ul",
      "ASDM7EC-light",
      "ASDM7EC-super",
    ]);
  });

  it("at DSD1024 offers the other AHM versions, not the EC line", () => {
    const a = advise({ setup: { dsd: "direct" }, rateHz: DSD1024, modulators: V61 });
    expect([a.start?.name, a.alternatives.map((x) => x.name)]).toEqual(["AHM7EC4B", ["AHM7EC8B", "AHM5EC4B", "AHM5EC8B"]]);
  });

  it("never offers AHM 5L as an alternative", () => {
    const names = advise({ setup: { dsd: "direct" }, rateHz: DSD1024 }).alternatives.map((x) => x.name);
    expect(names.filter((n) => n.endsWith("5L"))).toEqual([]);
  });

  it("names modulators the advice doesn't know: newer than our rules", () => {
    expect(advise({ setup: { dsd: "direct" }, modulators: [...V61, "AHM7EC9X"] }).unknown).toEqual(["AHM7EC9X"]);
  });

  it("knows every modulator HQPlayer 5 and 6.1 list", () => {
    expect([...advise({ setup: {}, modulators: V61 }).unknown, ...advise({ setup: {} }).unknown]).toEqual([]);
  });
});

describe("modulator advice: an unknown rate (auto, stopped)", () => {
  it("still gives a starting point, but says the rate isn't known", () => {
    const a = advise({ setup: { dsd: "direct", amp: "other", volume: "fixed" }, rateHz: 0 });
    expect([a.status, a.rateKnown, a.start?.name]).toEqual(["ok", false, "ASDM7EC-fast"]);
  });

  it("knows the rate when HQPlayer reports one", () => {
    expect(advise({ setup: { dsd: "direct" }, rateHz: 11_289_600 }).rateKnown).toBe(true);
  });
});

describe("modulator advice: the machine", () => {
  it("reads 0.8× processing speed as falling behind", () => {
    expect(advise({ setup: { dsd: "direct" }, processSpeed: 0.8 }).machine?.state).toBe("behind");
  });

  it("reads 1.2× as only just keeping up", () => {
    expect(advise({ setup: { dsd: "direct" }, processSpeed: 1.2 }).machine?.state).toBe("tight");
  });

  it("says nothing about the machine when the speed isn't known", () => {
    expect(advise({ setup: { dsd: "direct" }, processSpeed: null }).machine).toBeNull();
  });
});
