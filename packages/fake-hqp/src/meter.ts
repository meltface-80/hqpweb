// The fake's meter stream (HQPlayer's control port + 1): frames in the measured layout
// (@app/protocol meter.ts), sent in bursts of 12 every 250 ms while playing, nothing while
// paused or stopped (measured 2026-10-08: frames continue while paused on Desktop, and stop
// once it stops; the fake simplifies to "only while playing"). The spectrum is synthetic: a
// slope falling with frequency, plus the fake's volume in the levels.
import { createServer, type Server, type Socket } from "node:net";
import { encodeMeterFrame, type MeterFrame } from "@app/protocol";

const N = 1025;

export interface MeterSource {
  /** 2 = playing (Status state). */
  readonly playback: number;
  readonly volume: number;
}

export class FakeMeter {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private timer: NodeJS.Timeout | null = null;
  private readonly source: MeterSource;
  /** Frames sent so far, for tests. */
  sent = 0;

  constructor(source: MeterSource) {
    this.source = source;
  }

  async listen(port = 0, host = "127.0.0.1"): Promise<number> {
    this.server = createServer((s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
      s.on("error", () => s.destroy());
    });
    await new Promise<void>((r) => this.server!.listen(port, host, r));
    this.timer = setInterval(() => this.burst(), 250);
    const addr = this.server.address();
    return typeof addr === "object" && addr ? addr.port : port;
  }

  get connections() {
    return this.sockets.size;
  }

  private burst() {
    if (this.source.playback !== 2 || !this.sockets.size) return;
    for (let i = 0; i < 12; i++) {
      const buf = encodeMeterFrame(this.frame(this.sent++));
      for (const s of this.sockets) s.write(buf);
    }
  }

  private frame(k: number): MeterFrame {
    const v = this.source.volume;
    const mag = (i: number) => (0.3 / (1 + i / 40)) * (1 + 0.1 * Math.sin(k / 5 + i / 30));
    // Invented, so the Width view has something to show: the right channel's phase turns
    // with frequency (bass mono, the top wide), with the same magnitudes as the left, so
    // levels and bands are identical on both sides.
    const turn = (i: number) => Math.min(0.6, i / N) * Math.PI;
    const chan = (phase: (i: number) => number) => ({
      levels: [v + 2, v, v - 10, v - 8] as [number, number, number, number],
      re: Float32Array.from({ length: N }, (_, i) => mag(i) * Math.cos(phase(i))),
      im: Float32Array.from({ length: N }, (_, i) => mag(i) * Math.sin(phase(i))),
    });
    return {
      version: 1,
      channels: 2,
      length: N,
      bits: 16,
      bandwidth: 22050,
      xformTime: 0.02322,
      gain: 2,
      chans: [chan(() => 0), chan(turn)],
    };
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    for (const s of this.sockets) s.destroy();
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
  }
}
