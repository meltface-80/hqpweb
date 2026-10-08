// "Kept up here": how fast HQPlayer processed a combination on this machine once it had
// settled. HQPlayer's processing speed (Status process_speed: times faster than real
// time) is often low for the first seconds after a start or a change and then settles
// (seen by the owner), so a session skips a warm-up, then averages fixed windows. Its
// result is the lowest window ("low": the sustained worst, not a single bad reading) and
// the median ("typical"). Pure logic; the instance feeds it from the status poller.

export interface KeptTiming {
  /** Ignored at the start of every session. */
  warmupMs: number;
  /** Speed is averaged over windows this long. */
  windowMs: number;
  /** Windows needed before a session counts (and between later updates). */
  minWindows: number;
  /** Samples further apart than this end the session (nobody was watching). */
  maxGapMs: number;
}

export const KEPT_TIMING: KeptTiming = { warmupMs: 15_000, windowMs: 5000, minWindows: 6, maxGapMs: 5000 };

export interface KeptSample {
  t: number;
  /** What's playing, as one key (combination and source rate); null when not playing. */
  key: string | null;
  speed: number | null;
}

export interface KeptResult {
  key: string;
  /** Lowest window average once settled. */
  low: number;
  /** Median window average. */
  typical: number;
  windows: number;
  /** The session ended (later windows can't change this result). */
  final: boolean;
}

interface Session {
  key: string;
  start: number;
  lastT: number;
  windows: number[];
  cur: { start: number; sum: number; n: number } | null;
}

const round = (x: number) => Math.round(x * 100) / 100;

export class KeptUpTracker {
  private readonly timing: KeptTiming;
  private session: Session | null = null;

  constructor(timing: KeptTiming = KEPT_TIMING) {
    this.timing = timing;
  }

  /** One status sample. Returns a result when a session settles, updates, or ends. */
  feed(x: KeptSample): KeptResult | null {
    let out: KeptResult | null = null;
    const s = this.session;
    if (s && (x.key !== s.key || x.t - s.lastT > this.timing.maxGapMs)) out = this.end();
    if (x.key === null || x.speed === null || x.speed <= 0) return out;

    if (!this.session) this.session = { key: x.key, start: x.t, lastT: x.t, windows: [], cur: null };
    const cur = this.session;
    cur.lastT = x.t;
    if (x.t - cur.start < this.timing.warmupMs) return out;

    if (cur.cur && x.t - cur.cur.start >= this.timing.windowMs) {
      cur.windows.push(cur.cur.sum / cur.cur.n);
      cur.cur = null;
      const n = cur.windows.length;
      if (n % this.timing.minWindows === 0) out = this.summary(cur, false);
    }
    if (!cur.cur) cur.cur = { start: x.t, sum: 0, n: 0 };
    cur.cur.sum += x.speed;
    cur.cur.n++;
    return out;
  }

  /** Ends the current session: its final result if it settled, else null. */
  end(): KeptResult | null {
    const s = this.session;
    this.session = null;
    return s && s.windows.length >= this.timing.minWindows ? this.summary(s, true) : null;
  }

  private summary(s: Session, final: boolean): KeptResult {
    const w = [...s.windows].sort((a, b) => a - b);
    const mid = w.length >> 1;
    const median = w.length % 2 ? w[mid]! : (w[mid - 1]! + w[mid]!) / 2;
    return { key: s.key, low: round(w[0]!), typical: round(median), windows: w.length, final };
  }
}
