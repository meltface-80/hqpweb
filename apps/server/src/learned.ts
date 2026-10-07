// Combinations that failed on an instance, learned from rollbacks (design §4.4).
// Kept per instance and engine version, because both change what works.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { loadList } from "./jsonstore.ts";
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
}

const sameCombo = (a: Combo, b: Combo) =>
  a.mode === b.mode && a.rateHz === b.rateHz && a.filterNx === b.filterNx && a.filter1x === b.filter1x && a.shaper === b.shaper;

/** A failure's scope belongs to an instance: its own id, or `id#dac` for one of its named DACs. */
const ofInstance = (scope: string, instance: string) => scope === instance || scope.startsWith(`${instance}#`);

export class LearnedStore {
  private failures: Failure[] = [];
  private readonly path: string | null;

  /** path null = in memory only (tests). */
  constructor(path: string | null) {
    this.path = path;
    if (!path) return;
    // Saved before counts existed: once each, first seen when last seen.
    this.failures = loadList<Failure>(path, "failures").map((x) => ({ ...x, count: x.count ?? 1, first: x.first ?? x.at }));
  }

  /** A failure: counted against the same instance, engine and combination when there is one. */
  record(f: Failure) {
    const same = (x: Failure) => x.instance === f.instance && x.engine === f.engine && sameCombo(x, f);
    const prev = this.failures.find(same);
    this.failures = this.failures.filter((x) => !same(x));
    this.failures.push({ ...f, count: (prev?.count ?? 0) + 1, first: prev?.first ?? f.at });
    this.save();
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
    this.save();
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ format: SETTINGS_FORMAT, failures: this.failures }, null, 1) + "\n");
    renameSync(tmp, this.path);
  }
}
