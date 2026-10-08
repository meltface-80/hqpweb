// The live status stream for one instance (design §3: poll while someone is watching).
// Besides status, it reports health: how long Status took to answer, and how fast
// playback is advancing against the wall clock. Overload builds over minutes (measured,
// §2.3), so this runs continuously, not just after a change. When answers get slow,
// polling backs off so the app doesn't add load. Moved from instance.ts, unchanged.
import { cmd, queuedRate, type HqpClient, type State, type Status } from "@app/protocol";

export interface StatusEvent {
  snapshot?: Snapshot;
  /**
   * speed: playback position against the clock (30 s fit). processSpeed: HQPlayer's
   * own processing speed, averaged over ~3 s, when it reports one. Null = unknown.
   */
  health?: { latencyMs: number; speed: number | null; processSpeed: number | null };
  error?: string;
}

export interface VolumeJump {
  from: number;
  to: number;
  at: string;
  /** The connection dropped shortly before: HQPlayer most likely restarted. */
  restarted: boolean;
}

export interface Snapshot {
  status: Status;
  state: State;
  /** The volume rose sharply without hqpweb (e.g. HQPlayer restarted at its saved level). */
  volumeJump?: VolumeJump;
  /**
   * While stopped: the sample rate of the track HQPlayer's own playlist would play
   * next, if known. Status says nothing about a track that can't start (measured),
   * so this is how the app spots one. Absent while playing or when Roon feeds it.
   */
  queuedRate?: number | null;
}

export class StatusPoller {
  private readonly client: HqpClient;
  private readonly speedWindowMs: number;
  private readonly queueEveryMs: number;

  /** Every successful poll, for bookkeeping that needs the raw readings (kept-up.ts). */
  private readonly onTick: ((status: Status, state: State) => void) | undefined;

  constructor(
    client: HqpClient,
    opts: { speedWindowMs: number; queueEveryMs: number; onTick?: (status: Status, state: State) => void },
  ) {
    this.client = client;
    this.speedWindowMs = opts.speedWindowMs;
    this.queueEveryMs = opts.queueEveryMs;
    this.onTick = opts.onTick;
  }

  /** hqpweb itself just set the volume: not a jump. */
  noteOwnVolume(v: number) {
    this.ownVolume = { v, at: Date.now() };
  }

  // ---- shared status poller (design §3: poll while someone is watching) ----
  //
  // Besides status, it reports health: how long Status took to answer, and how
  // fast playback is advancing against the wall clock. Overload builds over
  // minutes (measured, §2.3), so this runs continuously, not just after a change.
  // When answers get slow, polling backs off so the app doesn't add load.

  private listeners = new Set<(e: StatusEvent) => void>();
  private timer: NodeJS.Timeout | null = null;
  private trail: { t: number; pos: number }[] = [];
  private processTrail: { t: number; v: number }[] = [];

  /**
   * HQPlayer's reported processing speed, averaged over the last ~3 s while playing.
   * It's how many times faster than real time HQPlayer processes (headroom), so it
   * isn't fooled by a slow output the way the position fit can be.
   */
  private averageProcessSpeed(status: Status): number | null {
    if (status.processSpeed === null) return null;
    const now = Date.now();
    if (status.state !== 2 || status.processSpeed <= 0) {
      this.processTrail = [];
      return null;
    }
    this.processTrail.push({ t: now, v: status.processSpeed });
    this.processTrail = this.processTrail.filter((p) => now - p.t <= 3000);
    const avg = this.processTrail.reduce((a, p) => a + p.v, 0) / this.processTrail.length;
    return Math.round(avg * 100) / 100;
  }
  // ---- volume rising without hqpweb ------------------------------------------
  // Measured (v6): every restart, and Embedded's "Refresh devices", brings the
  // volume back to −3 dB. A jump of 10 dB or more between two polls that hqpweb
  // didn't make is flagged until it's undone or dismissed. Hands on a knob move
  // in smaller steps (inferred), so they don't trip it.
  private lastVolume: { v: number; at: number } | null = null;
  private lastPollError = 0;
  private ownVolume: { v: number; at: number } | null = null;
  private volumeJump: VolumeJump | null = null;
  private noteVolume(v: number) {
    const now = Date.now();
    const prev = this.lastVolume;
    this.lastVolume = { v, at: now };
    if (this.volumeJump && v <= this.volumeJump.from + 1) this.volumeJump = null;
    // A long gap (nobody watching) proves nothing about how it got there.
    if (!prev || now - prev.at > 30 * 60_000 || v - prev.v < 10) return;
    // hqpweb's own writes (by time, not value: HQPlayer may clamp, and polls back off to 10 s).
    if (this.ownVolume && now - this.ownVolume.at < 15_000) return;
    this.volumeJump = { from: prev.v, to: v, at: new Date(now).toISOString(), restarted: now - this.lastPollError < 60_000 };
  }
  dismissVolumeJump() {
    this.volumeJump = null;
    return { ok: true };
  }

  // The queued track's rate, read from the playlist at most every queueEveryMs while stopped.
  private queued: { at: number; rate: number | null; list: string } | null = null;
  /**
   * After Roon was the source, HQPlayer's own playlist is left over and isn't what
   * plays next: ignore it until it changes (someone queued something in HQPlayer).
   * A track that can't start never shows as a source, so "changed" is the signal.
   * Until this server has seen what plays (e.g. after a restart), the playlist is
   * treated the same way: a missed warning beats a false one.
   */
  private stalePlaylist: string | null | undefined = null;
  private async queuedRateFor(status: Status): Promise<number | null | undefined> {
    if (status.source) {
      this.stalePlaylist = status.source.song === "Roon" ? null : undefined;
      this.queued = null;
      return undefined;
    }
    if (status.state === 2) return undefined;
    const now = Date.now();
    if (!this.queued || now - this.queued.at > this.queueEveryMs) {
      const el = await this.client.request(cmd.playlistGet()).catch(() => null);
      const list = el
        ? el.children
            .filter((c) => c.name === "PlaylistItem")
            .map((c) => `${c.attrs.uri ?? c.attrs.song ?? ""}@${c.attrs.rate ?? ""}`)
            .join("|")
        : "";
      this.queued = { at: now, rate: el ? queuedRate(el, status.track) : null, list };
    }
    if (this.stalePlaylist === null) this.stalePlaylist = this.queued.list; // first look after Roon
    if (this.stalePlaylist !== undefined) {
      if (this.queued.list === this.stalePlaylist) return null;
      this.stalePlaylist = undefined; // the playlist changed: it's HQPlayer's queue again
    }
    return this.queued.rate;
  }

  /** Bumped whenever polling starts or stops, so an in-flight tick from an old chain can't restart it. */
  private pollGen = 0;

  subscribe(fn: (e: StatusEvent) => void, intervalMs = 1000): () => void {
    this.listeners.add(fn);
    if (!this.timer) {
      const gen = ++this.pollGen;
      const tick = async () => {
        let event: StatusEvent;
        let next = intervalMs;
        const t0 = Date.now();
        try {
          const [status, state] = await Promise.all([this.client.status(), this.client.state()]);
          const latencyMs = Date.now() - t0;
          const queuedRate = await this.queuedRateFor(status);
          this.noteVolume(state.volume);
          this.onTick?.(status, state);
          event = {
            snapshot: {
              status,
              state,
              ...(queuedRate !== undefined ? { queuedRate } : {}),
              ...(this.volumeJump ? { volumeJump: this.volumeJump } : {}),
            },
            health: { latencyMs, speed: this.trackSpeed(status), processSpeed: this.averageProcessSpeed(status) },
          };
          // Inferred threshold: normal replies take ~1 ms on a kept-open connection (measured).
          if (latencyMs > 1000) next = Math.min(10_000, latencyMs * 3);
        } catch (e) {
          event = { error: (e as Error).message };
          this.lastPollError = Date.now();
          this.trail = [];
          this.processTrail = [];
          next = Math.min(10_000, intervalMs * 4);
        }
        if (gen !== this.pollGen) return; // stopped (or restarted) while this tick was in flight
        // One broken listener (e.g. a closed response) mustn't stop polling for everyone.
        for (const l of this.listeners) {
          try {
            l(event);
          } catch (e) {
            console.error(`status listener failed: ${(e as Error).message}`);
          }
        }
        if (this.listeners.size) this.timer = setTimeout(() => void tick(), next); // tick catches everything itself
      };
      this.timer = setTimeout(() => void tick(), 0);
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
        this.trail = [];
        this.processTrail = [];
        this.pollGen++;
      }
    };
  }

  /**
   * Playback speed against real time: the least-squares slope of position over
   * the last window (default 30 s). Position moves in ~1 s steps (measured), so a
   * two-point difference over a short window swung 0.94–1.04 while playback was
   * fine; a fitted slope over 30 s doesn't. Null when not playing or still filling.
   */
  private trackSpeed(status: Status): number | null {
    const now = Date.now();
    if (status.state !== 2) {
      this.trail = [];
      return null;
    }
    const last = this.trail[this.trail.length - 1];
    // A jump either way is a track change or seek: start over.
    if (last && (status.position < last.pos - 0.5 || status.position - last.pos > (now - last.t) / 1000 + 3)) this.trail = [];
    this.trail.push({ t: now, pos: status.position });
    // Keep a little more than the window, so uneven polling (it backs off to 10 s
    // when HQPlayer is slow) can't leave the trail permanently too short.
    this.trail = this.trail.filter((p) => now - p.t <= this.speedWindowMs * 1.5);
    const first = this.trail[0]!;
    if (now - first.t < this.speedWindowMs || this.trail.length < 3) return null;
    const n = this.trail.length;
    const mt = this.trail.reduce((a, p) => a + (p.t - first.t) / 1000, 0) / n;
    const mp = this.trail.reduce((a, p) => a + p.pos, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of this.trail) {
      const dt = (p.t - first.t) / 1000 - mt;
      num += dt * (p.pos - mp);
      den += dt * dt;
    }
    return den > 0 ? Math.round((num / den) * 1000) / 1000 : null;
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
