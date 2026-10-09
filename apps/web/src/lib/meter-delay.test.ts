import { describe, expect, it } from "vitest";
import { DelayLine, OWN_LAG_MS, clampNudge, meterDelayMs } from "./meter-delay.ts";

describe("holding the meter back to match what's heard", () => {
  it("waits HQPlayer's output delay less hqpweb's own lag, plus the nudge", () => {
    expect(meterDelayMs(1046, 0)).toBe(1046 - OWN_LAG_MS);
    expect(meterDelayMs(1046, 200)).toBe(1046 - OWN_LAG_MS + 200);
    expect(meterDelayMs(1046, -2000)).toBe(0); // never negative
    expect(meterDelayMs(null, 300)).toBe(300); // not reported: the nudge alone
    expect(meterDelayMs(0, 0)).toBe(0); // stopped
    expect(meterDelayMs(200, 0)).toBe(0); // a short buffer: no wait
  });
  it("keeps the nudge in range, in whole ms", () => {
    expect(clampNudge(9999)).toBe(3000);
    expect(clampNudge(-9999)).toBe(-2000);
    expect(clampNudge(100.4)).toBe(100);
  });
});

describe("the delay line", () => {
  it("gives the newest update that's due, and drops the ones before it", () => {
    const d = new DelayLine<string>();
    d.push(0, "a");
    d.push(100, "b");
    d.push(200, "c");
    expect(d.take(250, 600)).toBeUndefined();
    expect(d.take(750, 600)).toBe("b");
    expect(d.take(750, 600)).toBeUndefined(); // b was taken, c not due
    expect(d.take(800, 600)).toBe("c");
  });
  it("with no delay, passes updates straight through", () => {
    const d = new DelayLine<number>();
    d.push(10, 1);
    expect(d.take(10, 0)).toBe(1);
  });
  it("keeps at most `max` updates waiting", () => {
    const d = new DelayLine<number>(3);
    for (let i = 0; i < 10; i++) d.push(i, i);
    expect(d.take(100, 0)).toBe(9);
  });
});
