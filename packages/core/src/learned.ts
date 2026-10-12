// Combinations that failed on an instance, learned from rollbacks (design §4.4), and
// ones that kept up, with how fast (kept-up.ts). Kept per instance (or named DAC), engine
// version, and whether HQPlayer's DAC correction was running (Status `correction`), because all
// three change what works: correction is heavy (measured ~15-30% of the headroom). Other matrix
// processing isn't told apart: a deliberate simplification, open to requests (changes/ note).
import { DocWriter, listOf, loadDoc, type DocStore } from "./docs.ts";
import { SETTINGS_FORMAT } from "./format.ts";

const DOC = "learned.json";

export interface Combo {
  mode: string;
  /** Output rate actually in use, Hz. */
  rateHz: number;
  filterNx: string;
  filter1x: string;
  shaper: string;
  /**
   * HQPlayer's DAC correction was running (Status `correction`). Absent: not known (records from
   * before 0.1.0-beta.7), and such a record applies whether or not correction runs.
   */
  correction?: boolean;
}

export interface Failure extends Combo {
  instance: string;
  engine: string;
  /** The latest failure's reason and time. */
  reason: string;
  at: string;
  /** How many times this combination has failed here, and when first (a history). */
  count?: number;
  first?: string;
  /** Source sample rates it failed with (Hz); absent in records from before 0.1.0-beta.5. */
  sourceRates?: number[];
}

/** A combination that kept up here, once settled (kept-up.ts), from one source rate. */
export interface KeptUp extends Combo {
  instance: string;
  engine: string;
  sourceRate: number;
  /** Lowest settled 5-second average seen, times faster than real time. */
  low: number;
  /** The latest session's median. */
  typical: number;
  /** Settled sessions counted. */
  sessions: number;
  first: string;
  at: string;
}

/**
 * A filter HQPlayer took long to switch to here: it answered nothing meanwhile (watch.ts
 * BUSY_MS), and the music can stop for longer still (measured: 9.4 s busy, ~20 s heard).
 */
export interface SlowSwitch {
  instance: string;
  engine: string;
  mode: string;
  /** Output rate, Hz. */
  rateHz: number;
  filter: string;
  sourceRate: number;
  /** How long HQPlayer was busy, the latest time. */
  busyMs: number;
  at: string;
  /** How many times it's been seen. */
  count: number;
  /** HQPlayer's DAC correction was running; absent: not known (Combo.correction). */
  correction?: boolean;
}

/** The same record: correction known the same way (an unknown state is a record of its own). */
const sameState = (a: { correction?: boolean }, b: { correction?: boolean }) => a.correction === b.correction;
/** It applies with correction running or not: a record made in that state, or one from before it was known. */
const appliesTo = (r: { correction?: boolean }, correction: boolean | undefined) =>
  correction === undefined || r.correction === undefined || r.correction === correction;

const sameFields = (a: Combo, b: Combo) =>
  a.mode === b.mode && a.rateHz === b.rateHz && a.filterNx === b.filterNx && a.filter1x === b.filter1x && a.shaper === b.shaper;
const sameCombo = (a: Combo, b: Combo) => sameFields(a, b) && sameState(a, b);

/** A failure's scope belongs to an instance: its own id, or `id#dac` for one of its named DACs. */
const ofInstance = (scope: string, instance: string) => scope === instance || scope.startsWith(`${instance}#`);

export class LearnedStore {
  private failures: Failure[] = [];
  private kept: KeptUp[] = [];
  private slow: SlowSwitch[] = [];
  private readonly writer: DocWriter | null;

  /** Saved in `docs` (docs.ts), as loaded from there; null: in memory only (tests). */
  constructor(saved: { docs: DocStore; data: Record<string, unknown> | null } | null) {
    this.writer = saved && new DocWriter(saved.docs, DOC);
    const data = saved?.data ?? null;
    // Saved before counts existed: once each, first seen when last seen.
    this.failures = listOf<Failure>(data, "failures").map((x) => ({ ...x, count: x.count ?? 1, first: x.first ?? x.at }));
    this.kept = listOf<KeptUp>(data, "kept");
    this.slow = listOf<SlowSwitch>(data, "slow");
  }

  static async open(docs: DocStore): Promise<LearnedStore> {
    return new LearnedStore({ docs, data: await loadDoc(docs, DOC, "failures") });
  }

  /** Wait until what's been learned so far is saved. */
  flush(): Promise<void> {
    return this.writer?.flush() ?? Promise.resolve();
  }

  /** A failure: counted against the same instance, engine and combination when there is one. */
  record(f: Failure) {
    const same = (x: Failure) => x.instance === f.instance && x.engine === f.engine && sameCombo(x, f);
    const prev = this.failures.find(same);
    this.failures = this.failures.filter((x) => !same(x));
    const rates = [...new Set([...(prev?.sourceRates ?? []), ...(f.sourceRates ?? [])])];
    this.failures.push({
      ...f,
      count: (prev?.count ?? 0) + 1,
      first: prev?.first ?? f.at,
      ...(rates.length ? { sourceRates: rates } : {}),
    });
    this.save();
  }

  /**
   * A settled measurement (kept-up.ts). An update during a session refreshes the
   * numbers; a final one also counts the session. Low is the lowest ever seen.
   */
  recordKept(k: Omit<KeptUp, "sessions" | "first">, final: boolean) {
    const same = (x: KeptUp) =>
      x.instance === k.instance && x.engine === k.engine && x.sourceRate === k.sourceRate && sameCombo(x, k);
    const prev = this.kept.find(same);
    this.kept = this.kept.filter((x) => !same(x));
    this.kept.push({
      ...k,
      low: Math.min(k.low, prev?.low ?? Infinity),
      sessions: (prev?.sessions ?? 0) + (final ? 1 : 0),
      first: prev?.first ?? k.at,
    });
    this.save();
  }

  /** A slow switch: counted against the same instance, engine, mode, rate, filter and source rate. */
  recordSlow(s: Omit<SlowSwitch, "count">) {
    const same = (x: SlowSwitch) =>
      x.instance === s.instance &&
      x.engine === s.engine &&
      x.mode === s.mode &&
      x.rateHz === s.rateHz &&
      x.filter === s.filter &&
      x.sourceRate === s.sourceRate &&
      sameState(x, s);
    const prev = this.slow.find(same);
    this.slow = [...this.slow.filter((x) => !same(x)), { ...s, count: (prev?.count ?? 0) + 1 }];
    this.save();
  }

  // What applies now: this instance, engine and mode, with correction running or not.
  slowFor(instance: string, engine: string, mode: string, correction: boolean): SlowSwitch[] {
    return this.slow.filter((x) => x.instance === instance && x.engine === engine && x.mode === mode && appliesTo(x, correction));
  }

  keptFor(instance: string, engine: string, mode: string, correction: boolean): KeptUp[] {
    return this.kept.filter((k) => k.instance === instance && k.engine === engine && k.mode === mode && appliesTo(k, correction));
  }

  forInstance(instance: string, engine: string, mode: string, correction: boolean): Failure[] {
    return this.failures.filter(
      (f) => f.instance === instance && f.engine === engine && f.mode === mode && appliesTo(f, correction),
    );
  }

  /** An instance's failures, for all its DACs (kept under `id` and `id#dac`, dac-scope.ts). */
  all(instance: string): Failure[] {
    return this.failures.filter((f) => ofInstance(f.instance, instance));
  }

  /**
   * Forget one combination here, for every DAC and engine, as it applies with correction in the
   * given state (records from before it was known included): its failures and its runs that
   * didn't keep up (below 1x; the web's KEPT_UP). Runs that kept up stay. How many went.
   */
  forgetCombo(instance: string, c: Combo): number {
    const before = this.failures.length + this.kept.length;
    const same = (r: Combo) => sameFields(r, c) && appliesTo(r, c.correction);
    this.failures = this.failures.filter((f) => !(ofInstance(f.instance, instance) && same(f)));
    this.kept = this.kept.filter((k) => !(ofInstance(k.instance, instance) && same(k) && k.low < 1));
    const n = before - this.failures.length - this.kept.length;
    if (n) this.save();
    return n;
  }

  forget(instance: string) {
    this.failures = this.failures.filter((f) => !ofInstance(f.instance, instance));
    this.kept = this.kept.filter((k) => !ofInstance(k.instance, instance));
    this.slow = this.slow.filter((x) => !ofInstance(x.instance, instance));
    this.save();
  }

  /** In the background: a failed save is logged, never thrown, so it can't block a rollback. */
  private save() {
    this.writer?.writeQuietly(
      JSON.stringify({ format: SETTINGS_FORMAT, failures: this.failures, kept: this.kept, slow: this.slow }, null, 1) + "\n",
    );
  }
}
