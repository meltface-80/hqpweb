import { describe, expect, it } from "vitest";
import {
  bandBoxes,
  corrX,
  crest,
  dbTicks,
  DynHistory,
  freqTicks,
  heat,
  hexRgb,
  meterNote,
  mono,
  norm,
  PeakHold,
  peakRows,
  peakWords,
  ramp,
  Smoother,
} from "./meter-view.ts";

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

describe("the waterfall's colours follow the theme", () => {
  it("runs from the plot's background (silence) through the accent to the text colour (loudest)", () => {
    const c = ramp("#f6f5f2", "#1f8fc1", "#1a1c1f"); // light theme
    expect(c(-100)).toBe("rgb(246 245 242)");
    expect(c(-40)).toBe("rgb(31 143 193)");
    expect(c(0)).toBe("rgb(26 28 31)");
  });
  it("reads short and long hex, and falls back to the fixed colours otherwise", () => {
    expect(hexRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexRgb(" #1d2125 ")).toEqual([29, 33, 37]);
    expect(hexRgb("color-mix(in srgb, red 10%, blue)")).toBeNull();
    expect(ramp("oklch(0.5 0.1 200)", "#000", "#fff")).toBe(heat);
  });
});

describe("the strip's readings", () => {
  it("are one per row, left over right, short enough for a narrow column", () => {
    expect(
      peakRows([
        [-30, -32.5, -40, -35],
        [-30, -31.6, -40, -35],
      ]),
    ).toEqual(["L −32.5", "R −31.6"]);
    expect(peakRows([[-30, -130, -40, -35]])).toEqual(["—"]);
    expect(peakRows(undefined)).toEqual([]);
  });
});

describe("width and dynamics", () => {
  it("eases each band's correlation over recent updates", () => {
    const s = new Smoother(0.5);
    s.update([1, 0]);
    s.update([0, 0]);
    expect(s.values).toEqual([0.5, 0]);
  });
  it("places −1 at the left, 0 in the middle, mono at the right", () => {
    expect([corrX(-1), corrX(0), corrX(1), corrX(3)]).toEqual([0, 0.5, 1, 1]);
  });
  it("keeps the last 30 s of the loudest channel's peak and RMS", () => {
    const h = new DynHistory(30_000);
    h.push(0, [
      [-10, -12, -30, -28],
      [-10, -9, -31, -28],
    ]);
    h.push(31_000, [[-10, -20, -40, -38]]);
    expect(h.points).toEqual([{ t: 31_000, peak: -20, rms: -40 }]);
  });
  it("gives the crest factor as the median peak-to-RMS gap while there's sound", () => {
    const pts = [...Array(20)].map((_, i) => ({ peak: -10, rms: i < 15 ? -22 : -30 }));
    expect(crest(pts)).toBe(12);
    expect(crest(pts.map((p) => ({ ...p, rms: -95 })))).toBeNull(); // silence
    expect(crest(pts.slice(0, 5))).toBeNull(); // too little
  });
});
