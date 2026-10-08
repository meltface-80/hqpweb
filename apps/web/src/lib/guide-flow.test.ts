import { describe, expect, it } from "vitest";
import { canGoOn, firstOpen, flowSteps } from "./guide-flow.ts";

describe("the guide as a flow", () => {
  it("has the modulator guide's steps in DSD and the dither guide's in PCM, where to start last", () => {
    expect(flowSteps(true).map((s) => s.key)).toEqual(["dsd", "amp", "volume", null]);
    expect(flowSteps(false).map((s) => s.key)).toEqual(["pcm", "link", null]);
  });
  it("opens Next only once the step's question is answered", () => {
    const s = flowSteps(true);
    expect(canGoOn(s, 1, {})).toBe(false);
    expect(canGoOn(s, 1, { dsd: "direct" })).toBe(true);
    expect(canGoOn(s, 4, {})).toBe(true);
    expect(canGoOn(s, 5, {})).toBe(false);
  });
  it("starts at the first question still open, or at where to start when all are answered", () => {
    const s = flowSteps(true);
    expect(firstOpen(s, {})).toBe(1);
    expect(firstOpen(s, { dsd: "direct" })).toBe(2);
    expect(firstOpen(s, { dsd: "direct", amp: "other", volume: "fixed" })).toBe(4);
  });
});
