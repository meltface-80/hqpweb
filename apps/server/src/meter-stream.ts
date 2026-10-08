// HQPlayer's meter stream, for the browser (docs/design-v2-layout.md rule 9). Connects to
// the meter port (control port + 1) only while someone is watching, and lets go a few
// seconds after the last viewer leaves; reconnects if HQPlayer drops it. Frames are paced
// (meter-pace.ts) and condensed to log bands (@app/protocol meter.ts), ~20 updates a second.
// Read-only: the port takes no commands. Measured cost to HQPlayer: none (2026-10-08, PCM
// 384k on Linux; DSD256 and DSD1024 on macOS, alternating runs).
import { createConnection, type Socket } from "node:net";
import { bandEdges, condense, edgeHz, frameSize, parseMeterFrame, type MeterFrame } from "@app/protocol";
import { MeterPacer } from "./meter-pace.ts";

export interface MeterEvent {
  /** Frames are coming (HQPlayer is playing). */
  live: boolean;
  /** The meter port is connected. False: HQPlayer doesn't offer a meter here, or isn't reachable. */
  connected: boolean;
  /** Per channel: peakMax, peak, rms, rmsMax (dB). */
  levels?: number[][];
  /** Per channel: log-spaced bands from 20 Hz (40 at 1025 bins), dB. */
  bands?: number[][];
  /** The bands' edges in Hz (one more than bands), so low bands are drawn as wide as they are. */
  edgesHz?: number[];
}

export interface MeterTiming {
  tickMs: number;
  lingerMs: number;
  retryMs: number;
}
const TIMING: MeterTiming = { tickMs: 50, lingerMs: 5000, retryMs: 2000 };

export class MeterStream {
  private readonly host: string;
  private readonly port: number;
  private readonly timing: MeterTiming;
  private readonly listeners = new Set<(e: MeterEvent) => void>();
  private socket: Socket | null = null;
  private connected = false;
  private buf: Buffer = Buffer.alloc(0);
  private pacer = new MeterPacer<MeterFrame>();
  private edges: { key: string; edges: number[]; hz: number[] } | null = null;
  private tick: NodeJS.Timeout | null = null;
  private linger: NodeJS.Timeout | null = null;
  private retry: NodeJS.Timeout | null = null;

  constructor(host: string, port: number, timing: Partial<MeterTiming> = {}) {
    this.host = host;
    this.port = port;
    this.timing = { ...TIMING, ...timing };
  }

  subscribe(fn: (e: MeterEvent) => void): () => void {
    this.listeners.add(fn);
    if (this.linger) clearTimeout(this.linger);
    this.linger = null;
    if (!this.socket) this.open();
    if (!this.tick) this.tick = setInterval(() => this.emit(), this.timing.tickMs);
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.linger = setTimeout(() => this.stop(), this.timing.lingerMs);
    };
  }

  private open() {
    const s = createConnection({ host: this.host, port: this.port });
    this.socket = s;
    s.on("connect", () => (this.connected = true));
    s.on("data", (d) => this.onData(d));
    s.on("error", () => s.destroy());
    s.on("close", () => {
      this.connected = false;
      this.socket = null;
      this.buf = Buffer.alloc(0);
      if (this.listeners.size && !this.retry)
        this.retry = setTimeout(() => ((this.retry = null), this.open()), this.timing.retryMs);
    });
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    const now = Date.now();
    while (this.buf.length >= 32) {
      const size = frameSize(this.buf.readUInt32LE(4), this.buf.readUInt32LE(8));
      if (size > 1_000_000) {
        this.socket?.destroy(); // not a meter stream: give up on this connection
        return;
      }
      if (this.buf.length < size) return;
      this.pacer.push(parseMeterFrame(this.buf.subarray(0, size)), now);
      this.buf = this.buf.subarray(size);
    }
  }

  private emit() {
    const now = Date.now();
    const frame = this.pacer.take(now);
    const live = !!frame && this.pacer.live(now);
    const e: MeterEvent = { live, connected: this.connected };
    if (live && frame) {
      const key = `${frame.length}|${frame.bandwidth}`;
      if (this.edges?.key !== key) {
        const edges = bandEdges(frame.length, frame.bandwidth);
        this.edges = { key, edges, hz: edgeHz(edges, frame.length, frame.bandwidth).map((x) => Math.round(x)) };
      }
      Object.assign(e, condense(frame, this.edges.edges), { edgesHz: this.edges.hz });
    }
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // one broken listener (a closed response) mustn't stop the others
      }
    }
  }

  private stop() {
    if (this.tick) clearInterval(this.tick);
    if (this.retry) clearTimeout(this.retry);
    this.tick = this.retry = this.linger = null;
    this.socket?.destroy();
    this.socket = null;
    this.pacer = new MeterPacer<MeterFrame>();
  }

  close() {
    this.listeners.clear();
    if (this.linger) clearTimeout(this.linger);
    this.stop();
  }
}
