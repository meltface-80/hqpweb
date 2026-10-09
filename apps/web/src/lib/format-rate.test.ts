import { describe, expect, it } from "vitest";
import { formatRate, modeLabel } from "./api.ts";

describe("rates and modes, written one way", () => {
  it("writes DSD as DSDn and PCM in kHz", () => {
    expect([
      formatRate(11_289_600),
      formatRate(45_158_400),
      formatRate(1_536_000),
      formatRate(705_600),
      formatRate(44_100),
    ]).toEqual(["DSD256", "DSD1024", "1536 kHz", "705.6 kHz", "44.1 kHz"]);
    expect(formatRate(12_288_000)).toBe("DSD256 (48k)");
    expect(formatRate(0)).toBe("Auto");
  });
  it("tells DSD by the rate, not a mode that can be stale around a switch", () => {
    expect(formatRate(11_289_600, "PCM")).toBe("DSD256"); // was "11.2896 MHz"
    expect(formatRate(1_536_000, "SDM (DSD)")).toBe("1536 kHz");
  });
  it("calls SDM (DSD) DSD, as the card's tabs do", () => {
    expect([modeLabel("SDM (DSD)"), modeLabel("PCM"), modeLabel("[source]")]).toEqual(["DSD", "PCM", "[source]"]);
  });
});
