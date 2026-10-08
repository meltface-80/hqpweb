// Combinations that failed on an instance, learned from rollbacks (design §4.4), and
// ones that kept up, with how fast (kept-up.ts). Kept per instance (or named DAC) and
// engine version, because both change what works.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { loadList, loadOptionalList } from "./jsonstore.ts";
import { SETTINGS_FORMAT } from "./format.ts";
import { dirname } from "node:path";

export interface Combo {
  mode: string;
  /** Output rate actually in use, Hz. */
  rateHz: number;
  filterNx: string;
  filter1x: string;
  shaper: string;
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

const sameCombo = (a: Combo, b: Combo) =>
  a.mode === b.mode && a.rateHz === b.rateHz && a.filterNx === b.filterNx && a.filter1x === b.filter1x && a.shaper === b.shaper;

/** A failure's scope belongs to an instance: its own id, or `id#dac` for one of its named DACs. */
const ofInstance = (scope: string, instance: string) => scope === instance || scope.startsWith(`${instance}#`);

export class LearnedStore {
  private failures: Failure[] = [];
  private kept: KeptUp[] = [];
  private readonly path: string | null;

  /** path null = in memory only (tests). */
  constructor(path: string | null) {
    this.path = path;
    if (!path) return;
    // Saved before counts existed: once each, first seen when last seen.
    this.failures = loadList<Failure>(path, "failures").map((x) => ({ ...x, count: x.count ?? 1, first: x.first ?? x.at }));
    this.kept = loadOptionalList<KeptUp>(path, "kept");
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

  keptFor(instance: string, engine: string, mode: string): KeptUp[] {
    return this.kept.filter((k) => k.instance === instance && k.engine === engine && k.mode === mode);
  }

  forInstance(instance: string, engine: string, mode: string): Failure[] {
    return this.failures.filter((f) => f.instance === instance && f.engine === engine && f.mode === mode);
  }

  /** An instance's failures, for all its DACs (kept under `id` and `id#dac`, dac-scope.ts). */
  all(instance: string): Failure[] {
    return this.failures.filter((f) => ofInstance(f.instance, instance));
  }

  forget(instance: string) {
    this.failures = this.failures.filter((f) => !ofInstance(f.instance, instance));
    this.kept = this.kept.filter((k) => !ofInstance(k.instance, instance));
    this.save();
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ format: SETTINGS_FORMAT, failures: this.failures, kept: this.kept }, null, 1) + "\n");
    renameSync(tmp, this.path);
  }
}
