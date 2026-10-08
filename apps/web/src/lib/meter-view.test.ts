import { describe, expect, it } from "vitest";
import { heat, meterNote, mono, norm, PeakHold } from "./meter-view.ts";

describe("meter drawing rules", () => {
  it("scales -100..0 dB to 0..1, clamped", () => {
    expect([norm(-120), norm(-100), norm(-50), norm(0), norm(6)]).toEqual([0, 0, 0.5, 1, 1]);
  });

  it("shows the louder channel per band in the single-row views", () => {
    expect(
      mono([
        [-10, -40],
        [-20, -30],
      ]),
    ).toEqual([-10, -30]);
  });

  it("holds each band's peak for a while, then lets it fall", () => {
    const p = new PeakHold(1000, 20); // hold 1 s, then fall 20 dB/s
    p.update([-10], 0);
    p.update([-40], 500);
    expect(p.values[0]).toBe(-10); // still held
    p.update([-40], 1500);
    expect(p.values[0]).toBeCloseTo(-20, 5); // 0.5 s of falling at 20 dB/s
    p.update([-5], 1600);
    expect(p.values[0]).toBe(-5); // a new peak resets it
  });

  it("colours the waterfall from dark (quiet) to bright (loud)", () => {
    const [q, l] = [heat(-100), heat(0)];
    expect(q).toMatch(/^hsl\(/);
    expect(q).not.toBe(l);
  });

  it("says plainly when there's no meter, or it's quiet", () => {
    expect(meterNote({ live: false, connected: false }, true)).toBe("No meter from this HQPlayer");
    expect(meterNote({ live: false, connected: true }, true)).toBe("Quiet");
    expect(meterNote({ live: false, connected: true }, false)).toBe("Not playing");
    expect(meterNote({ live: true, connected: true }, true)).toBe("");
  });
});
