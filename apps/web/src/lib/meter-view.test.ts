import { describe, expect, it } from "vitest";
import { bandBoxes, dbTicks, freqTicks, heat, meterNote, mono, norm, PeakHold, peakWords } from "./meter-view.ts";

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

describe("placing bands by frequency", () => {
  it("fills the width in order, the lowest band wider than a top one (it spans a whole bin)", () => {
    const edges = [21.5, 43, 64.6, 86.1, 10000, 20000, 22050];
    const boxes = bandBoxes(edges, 600);
    expect(boxes[0]!.x).toBe(0);
    const last = boxes[boxes.length - 1]!;
    expect(last.x + last.w).toBeCloseTo(600, 6);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.x).toBeCloseTo(boxes[i - 1]!.x + boxes[i - 1]!.w, 6);
    expect(boxes[0]!.w).toBeGreaterThan(last.w);
  });
});

describe("the axes", () => {
  it("puts 20 Hz, 200, 2k and 20 kHz where the log scale puts them, not evenly", () => {
    const t = freqTicks([20, 22_050]);
    expect(t.map((x) => x.label)).toEqual(["20 Hz", "200", "2k", "20 kHz"]);
    expect(t[0]!.x).toBeCloseTo(0);
    expect(t[1]!.x).toBeCloseTo(Math.log(10) / Math.log(22_050 / 20)); // a decade is ~a third
    expect(t[3]!.x).toBeLessThan(1);
  });
  it("puts 20 Hz on the edge when the first band starts just above it (one 21.5 Hz bin)", () => {
    expect(freqTicks([21.5, 22_050])[0]).toEqual({ label: "20 Hz", x: 0 });
  });
  it("leaves out a tick well outside the bands", () => {
    expect(freqTicks([40, 22_050]).map((x) => x.label)).toEqual(["200", "2k", "20 kHz"]);
  });
  it("marks every 20 dB on the same scale as the bars", () => {
    expect(dbTicks().map((t) => [t.label, t.y])).toEqual([
      ["0 dB", 1],
      ["-20", 0.8],
      ["-40", 0.6],
      ["-60", 0.4],
      ["-80", 0.2],
    ]);
  });
});

describe("the strip's words", () => {
  it("names the channels and says peak", () => {
    expect(
      peakWords([
        [-30, -32.5, -40, -35],
        [-30, -31.6, -40, -35],
      ]),
    ).toBe("Peak L −32.5 · R −31.6 dB");
    expect(peakWords([[-30, -130, -40, -35]])).toBe("Peak — dB");
    expect(peakWords(undefined)).toBe("");
  });
});
