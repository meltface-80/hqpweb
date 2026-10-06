import { describe, expect, it } from "vitest";
import { answersSlowly, isSlow, speedClass, speedText, behindStreak, lasting, SUSTAIN } from "./speed.ts";

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

describe("slow signals", () => {
  it("counts the position fit as slow below 0.97", () => {
    expect(isSlow(0.969)).toBe(true);
    expect(isSlow(0.97)).toBe(false);
    expect(isSlow(null)).toBe(false);
  });

  it("calls replies over 1.5 s slow (normal is about 1 ms, measured)", () => {
    expect(answersSlowly(1501)).toBe(true);
    expect(answersSlowly(1500)).toBe(false);
    expect(answersSlowly(undefined)).toBe(false);
  });
});

describe("boundaries (found by mutation testing)", () => {
  it("is not red at exactly 0.90 from the position fit", () => {
    expect(speedClass(null, 0.9, null)).toBe("ok");
  });
  it("shows whole numbers from 10× up, one decimal below", () => {
    expect(speedText(10, null, "ok")).toBe("10×");
    expect(speedText(9.5, null, "ok")).toBe("9.5×");
  });
});

describe("a falling-behind reading that lasts", () => {
  it("counts consecutive readings below real time, and resets on a good one", () => {
    const seq = [0.9, 0.95, 0.9, 1.2, 0.9].reduce<number[]>((acc, sp) => [...acc, behindStreak(acc.at(-1) ?? 0, sp)], []);
    expect(seq).toEqual([1, 2, 3, 0, 1]);
  });

  it("raises the alarm only once it has lasted", () => {
    expect([lasting(SUSTAIN - 1), lasting(SUSTAIN)]).toEqual([false, true]);
  });
});
