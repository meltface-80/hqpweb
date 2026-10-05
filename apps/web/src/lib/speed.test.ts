import { describe, expect, it } from "vitest";
import { speedClass, speedText } from "./speed.ts";

describe("Processing, from HQPlayer's own figure (5.17.2+, calibrated on a real instance)", () => {
  it("is red below 1× (can't keep up), amber below 1.15× (little headroom), green above", () => {
    expect(speedClass(0.99, null, null)).toBe("bad");
    expect(speedClass(1.0, null, null)).toBe("warn");
    expect(speedClass(1.14, null, null)).toBe("warn");
    expect(speedClass(1.15, null, null)).toBe("ok");
  });

  it("wins over hqpweb's own position fit", () => {
    expect(speedClass(25, 0.5, 60_000)).toBe("ok");
  });

  it("shows the figure itself", () => {
    expect(speedText(31.5, null, "ok")).toBe("32×");
    expect(speedText(1.08, null, "warn")).toBe("1.1×");
  });
});

describe("Processing, from hqpweb's 30 s position fit (older HQPlayer)", () => {
  it("is red below 0.90 at once", () => {
    expect(speedClass(null, 0.89, null)).toBe("bad");
  });

  it("turns amber only after 15 s below 0.97, so brief dips during a change don't alarm", () => {
    expect(speedClass(null, 0.95, 14_999)).toBe("ok");
    expect(speedClass(null, 0.95, 15_000)).toBe("warn");
  });

  it("shows nothing until there's a figure", () => {
    expect(speedClass(null, null, null)).toBe("");
    expect(speedText(null, null, "")).toBe("—");
  });
});
