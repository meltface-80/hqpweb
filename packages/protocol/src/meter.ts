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

/** Bin indices bounding `count` log-spaced bands from 20 Hz to the bandwidth. */
export function bandEdges(length: number, bandwidth: number, count = 48, low = 20): number[] {
  const binHz = bandwidth / (length - 1);
  return Array.from({ length: count + 1 }, (_, i) => {
    const hz = low * (bandwidth / low) ** (i / count);
    return Math.min(length - 1, Math.max(1, Math.round(hz / binHz)));
  });
}

const db = (x: number) => (x > 0 ? Math.max(NO_LEVEL, 20 * Math.log10(x)) : NO_LEVEL);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Per channel: the four levels and the loudest bin in each band, in dB. */
export function condense(f: MeterFrame, edges: number[]): { levels: number[][]; bands: number[][] } {
  return {
    levels: f.chans.map((c) => c.levels.map((v) => (v < -300 ? NO_LEVEL : r1(v)))),
    bands: f.chans.map((c) => {
      const out: number[] = [];
      for (let b = 0; b + 1 < edges.length; b++) {
        let m = 0;
        for (let i = edges[b]!; i < Math.max(edges[b + 1]!, edges[b]! + 1); i++) m = Math.max(m, Math.hypot(c.re[i]!, c.im[i]!));
        out.push(r1(db(m * f.gain)));
      }
      return out;
    }),
  };
}
