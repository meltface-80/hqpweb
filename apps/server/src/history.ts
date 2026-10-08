// What changed on an instance, when, from where and how it went; and the settings last
// seen in each mode. HQPlayer's State only reports the mode in use, so a mode's settings
// can be shown while in another mode only as hqpweb last saw them. Both are kept per
// DAC scope (dac-scope.ts) in history.json.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SETTINGS_FORMAT } from "./format.ts";
import { loadList, loadOptionalList } from "./jsonstore.ts";
import type { Settings } from "./settings.ts";

/** Where a change came from: hqpweb (a change or a preset), its undo, or somewhere else (HQPlayer's own window, another app). */
export type ChangeSource = "hqpweb" | "preset" | "undo" | "elsewhere";

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
  /** For hqpweb's own changes: whether HQPlayer took it (read back). */
  applied?: boolean;
}

export interface HistoryEntry {
  at: string;
  /** The DAC scope: the instance id, or `id#dac`. */
  instance: string;
  source: ChangeSource;
  changes: FieldChange[];
  /** For hqpweb's changes: how playback went (change-engine.ts PlaybackCheck.kind), and why. */
  playback?: string;
  detail?: string;
  /** Playback failed and hqpweb put the previous settings back. */
  rolledBack?: boolean;
}

/** One mode's settings as last seen. */
export interface Seen {
  instance: string;
  mode: string;
  rate: number;
  filterNx: string;
  filter1x: string;
  shaper: string;
  at: string;
}

/** Settings that count as history. Volume is left out: turning a knob isn't a change worth listing. */
const TRACKED = [
  "mode",
  "rate",
  "filterNx",
  "filter1x",
  "shaper",
  "invert",
  "filter20k",
  "adaptive",
  "convolution",
  "matrixProfile",
] as const;

export function changedFields(prev: Settings, now: Settings): FieldChange[] {
  return TRACKED.filter((f) => prev[f] !== now[f]).map((f) => ({ field: f, from: prev[f], to: now[f] }));
}

const ofInstance = (scope: string, instance: string) => scope === instance || scope.startsWith(`${instance}#`);
/** Last-seen settings are saved when they change, or this often to refresh their time. */
const SEEN_SAVE_MS = 10 * 60_000;

export class HistoryStore {
  private entries: HistoryEntry[];
  private seenList: Seen[];
  private readonly path: string | null;
  private readonly max: number;
  private lastSave = 0;

  /** path null = in memory only (tests). `max` caps the number of entries kept. */
  constructor(path: string | null, max = 500) {
    this.path = path;
    this.max = max;
    this.entries = path ? loadList<HistoryEntry>(path, "entries") : [];
    this.seenList = path ? loadOptionalList<Seen>(path, "seen") : [];
  }

  push(e: HistoryEntry) {
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries = this.entries.slice(-this.max);
    this.save();
  }

  /** An instance's entries, its DACs' included, newest first. */
  forInstance(instance: string): HistoryEntry[] {
    return this.entries.filter((e) => ofInstance(e.instance, instance)).reverse();
  }

  seen(scope: string, s: Settings, at: string) {
    const prev = this.seenList.find((x) => x.instance === scope && x.mode === s.mode);
    const next: Seen = {
      instance: scope,
      mode: s.mode,
      rate: s.rate,
      filterNx: s.filterNx,
      filter1x: s.filter1x,
      shaper: s.shaper,
      at,
    };
    const changed =
      !prev ||
      prev.rate !== next.rate ||
      prev.filterNx !== next.filterNx ||
      prev.filter1x !== next.filter1x ||
      prev.shaper !== next.shaper;
    this.seenList = [...this.seenList.filter((x) => x !== prev), next];
    if (changed || Date.parse(at) - this.lastSave > SEEN_SAVE_MS) this.save();
  }

  /** The DAC scope's settings as last seen, by mode name. */
  lastSeen(scope: string): Record<string, Omit<Seen, "instance" | "mode">> {
    const out: Record<string, Omit<Seen, "instance" | "mode">> = {};
    for (const { instance, mode, ...rest } of this.seenList) if (instance === scope) out[mode] = rest;
    return out;
  }

  forget(instance: string) {
    this.entries = this.entries.filter((e) => !ofInstance(e.instance, instance));
    this.seenList = this.seenList.filter((x) => !ofInstance(x.instance, instance));
    this.save();
  }

  private save() {
    this.lastSave = Date.now();
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ format: SETTINGS_FORMAT, entries: this.entries, seen: this.seenList }, null, 1) + "\n");
    renameSync(tmp, this.path);
  }
}
