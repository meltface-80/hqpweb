// HQPlayer's meter stream: binary frames on the control port + 1 (4322), sent while
// playing, no command or auth (measured 2026-10-08 on Desktop 5.35.10 Linux and Desktop 5
// macOS; matches the MIT SDK's clMeterInterface). Little-endian:
//   u32 version, u32 channels, u32 length (bins), u32 bits, f32 bandwidth (Hz),
//   f32 xformTime (s), f32 gain, 4 reserved bytes; then per channel:
//   f32 peakMax, peak, rms, rmsMax (dB; -386 until there is a reading),
//   f32 re[length], f32 im[length] (the spectrum).
// Measured: 2 channels, 1025 bins, 22050 Hz, 23.2 ms, gain 2; 16464-byte frames, sent
// in bursts (~12 at a time, ~4 times a second) at ~43 a second in PCM, ~180 in DSD.

export interface MeterChannel {
  /** peakMax, peak, rms, rmsMax, in dB. */
  levels: [number, number, number, number];
  re: Float32Array;
  im: Float32Array;
}

export interface MeterFrame {
  version: number;
  channels: number;
  length: number;
  bits: number;
  bandwidth: number;
  xformTime: number;
  gain: number;
  chans: MeterChannel[];
}

/** A level HQPlayer hasn't measured yet (it sends -386). */
export const NO_LEVEL = -120;
const HEADER = 32;

export const frameSize = (channels: number, length: number) => HEADER + channels * (16 + 8 * length);

export function parseMeterFrame(buf: Buffer): MeterFrame {
  const channels = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  if (buf.length < frameSize(channels, length)) throw new Error(`meter frame too short: ${buf.length} bytes`);
  const chans: MeterChannel[] = [];
  let off = HEADER;
  for (let c = 0; c < channels; c++) {
    const levels = [0, 1, 2, 3].map((i) => buf.readFloatLE(off + 4 * i)) as MeterChannel["levels"];
    off += 16;
    const re = new Float32Array(length);
    const im = new Float32Array(length);
    for (let i = 0; i < length; i++) re[i] = buf.readFloatLE(off + 4 * i);
    off += 4 * length;
    for (let i = 0; i < length; i++) im[i] = buf.readFloatLE(off + 4 * i);
    off += 4 * length;
    chans.push({ levels, re, im });
  }
  return {
    version: buf.readUInt32LE(0),
    channels,
    length,
    bits: buf.readUInt32LE(12),
    bandwidth: buf.readFloatLE(16),
    xformTime: buf.readFloatLE(20),
    gain: buf.readFloatLE(24),
    chans,
  };
}

/** The same layout, for the fake HQPlayer. */
export function encodeMeterFrame(f: MeterFrame): Buffer {
  const buf = Buffer.alloc(frameSize(f.channels, f.length));
  buf.writeUInt32LE(f.version, 0);
  buf.writeUInt32LE(f.channels, 4);
  buf.writeUInt32LE(f.length, 8);
  buf.writeUInt32LE(f.bits, 12);
  buf.writeFloatLE(f.bandwidth, 16);
  buf.writeFloatLE(f.xformTime, 20);
  buf.writeFloatLE(f.gain, 24);
  let off = HEADER;
  for (const c of f.chans) {
    c.levels.forEach((v, i) => buf.writeFloatLE(v, off + 4 * i));
    off += 16;
    for (let i = 0; i < f.length; i++) buf.writeFloatLE(c.re[i] ?? 0, off + 4 * i);
    off += 4 * f.length;
    for (let i = 0; i < f.length; i++) buf.writeFloatLE(c.im[i] ?? 0, off + 4 * i);
    off += 4 * f.length;
  }
  return buf;
}

/**
 * Bin indices bounding log-spaced bands from 20 Hz to the bandwidth: aiming for `count`,
 * but each band gets bins of its own. A bin is ~21.5 Hz wide (1025 bins over 22050 Hz), so
 * below a few hundred Hz log bands are narrower than a bin; those merge (48 aimed → 40 real).
 * Before, they shared a bin and moved together in groups (seen on the owner's test build, 2026-10-08).
 */
export function bandEdges(length: number, bandwidth: number, count = 48, low = 20): number[] {
  const binHz = bandwidth / (length - 1);
  const edges = Array.from({ length: count + 1 }, (_, i) =>
    Math.min(length - 1, Math.max(1, Math.round((low * (bandwidth / low) ** (i / count)) / binHz))),
  );
  return edges.filter((e, i) => i === 0 || e > edges[i - 1]!);
}

/** Each edge's frequency (Hz), so the low bands can be drawn as wide as they really are. */
export const edgeHz = (edges: number[], length: number, bandwidth: number) => edges.map((e) => (e * bandwidth) / (length - 1));

const db = (x: number) => (x > 0 ? Math.max(NO_LEVEL, 20 * Math.log10(x)) : NO_LEVEL);
const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * How alike left and right are in each band, from the bins' real and imaginary parts:
 * Re(Σ L·R*) / √(Σ|L|²·Σ|R|²). 1: the same (mono); 0: unrelated (wide); −1: opposite
 * (out of phase). 0 for a silent band. Two decimals.
 */
export function bandCorrelation(l: { re: ArrayLike<number>; im: ArrayLike<number> }, r: typeof l, edges: number[]): number[] {
  const out: number[] = [];
  for (let b = 0; b + 1 < edges.length; b++) {
    let cross = 0;
    let ll = 0;
    let rr = 0;
    for (let i = edges[b]!; i < edges[b + 1]!; i++) {
      cross += l.re[i]! * r.re[i]! + l.im[i]! * r.im[i]!;
      ll += l.re[i]! ** 2 + l.im[i]! ** 2;
      rr += r.re[i]! ** 2 + r.im[i]! ** 2;
    }
    out.push(ll > 0 && rr > 0 ? Math.round((cross / Math.sqrt(ll * rr)) * 100) / 100 : 0);
  }
  return out;
}

/**
 * Per channel: the four levels and the loudest bin in each band (bands from bandEdges), in
 * dB; with two or more channels, the first two's correlation per band (bandCorrelation).
 */
export function condense(f: MeterFrame, edges: number[]): { levels: number[][]; bands: number[][]; corr?: number[] } {
  return {
    ...(f.chans.length >= 2 ? { corr: bandCorrelation(f.chans[0]!, f.chans[1]!, edges) } : {}),
    levels: f.chans.map((c) => c.levels.map((v) => (v < -300 ? NO_LEVEL : r1(v)))),
    bands: f.chans.map((c) => {
      const out: number[] = [];
      for (let b = 0; b + 1 < edges.length; b++) {
        let m = 0;
        for (let i = edges[b]!; i < edges[b + 1]!; i++) m = Math.max(m, Math.hypot(c.re[i]!, c.im[i]!));
        out.push(r1(db(m * f.gain)));
      }
      return out;
    }),
  };
}
