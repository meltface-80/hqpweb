// HQPlayer's meter stream (control port + 1): the frame layout decoded on 2026-10-08 from
// Desktop 5.35.10 (Linux, PCM) and 5.x (macOS, DSD), matching the MIT SDK's clMeterInterface.
import { describe, expect, it } from "vitest";
import {
  bandEdges,
  condense,
  edgeHz,
  encodeMeterFrame,
  frameSize,
  NO_LEVEL,
  parseMeterFrame,
  type MeterFrame,
} from "../src/meter.ts";

/** The header as measured on both machines: 2 ch, 1025 bins, 16 bits, 22050 Hz, 23.2 ms, gain 2. */
function frame(o: { re?: (i: number) => number; levels?: [number, number, number, number] } = {}): MeterFrame {
  const n = 1025;
  const chan = () => ({
    levels: o.levels ?? ([-20.2, -22.9, -32.4, -31.7] as [number, number, number, number]),
    re: Float32Array.from({ length: n }, (_, i) => o.re?.(i) ?? 0),
    im: new Float32Array(n),
  });
  return { version: 1, channels: 2, length: n, bits: 16, bandwidth: 22050, xformTime: 0.02322, gain: 2, chans: [chan(), chan()] };
}

describe("meter frames", () => {
  it("are 16464 bytes for 2 channels of 1025 bins, as measured", () => {
    expect(frameSize(2, 1025)).toBe(16464);
    expect(encodeMeterFrame(frame()).length).toBe(16464);
  });

  it("decode what they encode, header and levels included", () => {
    const f = parseMeterFrame(encodeMeterFrame(frame({ re: (i) => (i === 100 ? 0.25 : 0) })));
    expect([f.version, f.channels, f.length, f.bits, f.bandwidth, f.gain]).toEqual([1, 2, 1025, 16, 22050, 2]);
    expect(f.chans[0]!.levels[1]).toBeCloseTo(-22.9, 4);
    expect(f.chans[1]!.re[100]).toBeCloseTo(0.25, 6);
  });

  it("know their size from the first 32 bytes", () => {
    const buf = encodeMeterFrame(frame());
    expect(frameSize(buf.readUInt32LE(4), buf.readUInt32LE(8))).toBe(buf.length);
  });
});

describe("condensing a frame for the browser", () => {
  const edges = bandEdges(1025, 22050);

  it("spaces bands logarithmically from 20 Hz to the bandwidth, each with bins of its own", () => {
    // ~21.5 Hz per bin: below a few hundred Hz, log bands are narrower than a bin. Before,
    // several bands shared one bin and moved together in groups (seen on the owner's test build, 2026-10-08).
    expect(edges[0]).toBe(1);
    expect(edges[edges.length - 1]).toBe(1024);
    for (let i = 1; i < edges.length; i++) expect(edges[i]!).toBeGreaterThan(edges[i - 1]!);
    expect(edges.length - 1).toBe(40);
  });

  it("never gives two bands the same bins: a different value in every bin, a different value in every band", () => {
    const c = condense(frame({ re: (i) => 0.001 * (i + 1) }), edges);
    expect(new Set(c.bands[0]).size).toBe(c.bands[0]!.length);
  });

  it("gives each band's frequency span, for drawing low bands wider", () => {
    const hz = edgeHz(edges, 1025, 22050);
    expect(hz[0]).toBeCloseTo(21.5, 0);
    expect(hz[hz.length - 1]).toBeCloseTo(22050, 0);
  });

  it("puts a 1 kHz tone in the band that holds 1 kHz, loudest there", () => {
    const bin = Math.round((1000 / 22050) * 1024); // ~46
    const c = condense(frame({ re: (i) => (i === bin ? 0.5 : 0.0001) }), edges);
    const loudest = c.bands[0]!.indexOf(Math.max(...c.bands[0]!));
    expect(edges[loudest]!).toBeLessThanOrEqual(bin);
    expect(edges[loudest + 1]!).toBeGreaterThan(bin);
    expect(c.bands[0]![loudest]).toBeCloseTo(20 * Math.log10(0.5 * 2), 1); // × gain
  });

  it("passes the levels through, and marks -386 (none yet) as no level", () => {
    expect(condense(frame(), edges).levels[0]).toEqual([-20.2, -22.9, -32.4, -31.7]);
    expect(condense(frame({ levels: [-386, -386, -386, -386] }), edges).levels[0]).toEqual([
      NO_LEVEL,
      NO_LEVEL,
      NO_LEVEL,
      NO_LEVEL,
    ]);
  });
});
