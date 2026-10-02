// One HQPlayer instance: capability cache, the change engine, undo, and a shared
// status poller.
//
// Change engine (design §4.2, generalised): resolve names → apply in order →
// read State back → if the change could disturb playback and something was
// playing, watch it → if playback stopped or can't keep up, record the
// combination as failed and roll back to the snapshot.
import {
  HqpClient,
  cmd,
  type Filter,
  type Info,
  type Mode,
  type Outcome,
  type Rate,
  type Shaper,
  type State,
  type Status,
  type VolumeRange,
} from "@app/protocol";
import type { InstanceConfig } from "./config.ts";
import { LearnedStore, type Combo, type Failure } from "./learned.ts";
import { DEFAULT_TIMING, MAJOR_TIMING, watchPlayback, type Verdict, type WatchTiming } from "./watch.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Largest single volume *raise* accepted, in dB. Lowering is never limited. */
export const MAX_RAISE_DB = 6;
/** Volume read-back tolerance, dB. */
const VOLUME_EPS = 0.01;

/** A change, by NAME (never index), design §4.3. Every field optional. */
export interface Change {
  mode?: string;
  /** Output rate in Hz; 0 is auto. */
  rate?: number;
  filterNx?: string;
  filter1x?: string;
  shaper?: string;
  volume?: number;
  invert?: boolean;
  filter20k?: boolean;
  adaptive?: boolean;
}
export type Field = keyof Change;

/** Fields whose change can stop playback or overload the machine. */
const RISKY: readonly Field[] = ["mode", "rate", "filterNx", "filter1x", "shaper"];

export interface RateOption extends Rate {
  /** False when above this instance's configured limit. */
  allowed: boolean;
  note?: string;
}

export interface Capabilities {
  engine: string;
  mode: Mode;
  modes: Mode[];
  filters: Filter[];
  shapers: Shaper[];
  rates: RateOption[];
  /** SetRate is ignored in [source] mode (reported by HQPTuner). */
  rateSettable: boolean;
  volumeRange: VolumeRange;
  /** Combinations that failed here before, for this engine and mode. */
  knownBad: Failure[];
}

export interface FieldResult {
  field: Field;
  requested: string | number | boolean;
  /** What State reports afterwards, translated back to a name where relevant. */
  actual: string | number | boolean;
  /** Whether State shows the requested value. This, not the reply, is the verdict. */
  applied: boolean;
  /** The command's own reply, for diagnostics only. */
  reply: Outcome;
  note?: string;
}

export type PlaybackCheck = Verdict | { kind: "not-checked"; detail: string };

export interface ApplyResult {
  /** Major = mode or rate changed (design §4.2). */
  class: "quick" | "major";
  results: FieldResult[];
  playback: PlaybackCheck;
  /** Present when playback failed and the change was undone automatically. */
  rolledBack: { results: FieldResult[]; playback: PlaybackCheck } | null;
  state: State;
  undoAvailable: boolean;
}

export interface Snapshot {
  status: Status;
  state: State;
}

/** Every setting this engine manages, by name. */
interface Settings {
  mode: string;
  rate: number;
  filterNx: string;
  filter1x: string;
  shaper: string;
  volume: number;
  invert: boolean;
  filter20k: boolean;
  adaptive: boolean;
}

const nameOf = <T extends { index: number; name: string }>(list: T[], i: number) =>
  list.find((x) => x.index === i)?.name ?? `#${i}`;

function settingsOf(caps: Capabilities, s: State): Settings {
  return {
    mode: caps.mode.name,
    rate: caps.rates.find((r) => r.index === s.rate)?.rate ?? 0,
    filterNx: nameOf(caps.filters, s.filterNx),
    filter1x: nameOf(caps.filters, s.filter1x),
    shaper: nameOf(caps.shapers, s.shaper),
    volume: s.volume,
    invert: s.invert,
    filter20k: s.filter20k,
    adaptive: s.adaptive,
  };
}

export interface InstanceOptions {
  client?: HqpClient;
  learned?: LearnedStore;
  timing?: { quick: WatchTiming; major: WatchTiming };
}

export class Instance {
  readonly cfg: InstanceConfig;
  readonly client: HqpClient;
  private readonly learned: LearnedStore;
  private readonly timing: { quick: WatchTiming; major: WatchTiming };
  private caps: { key: string; value: Capabilities } | null = null;
  /** Writes to one instance run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The previous values of the fields the last change touched, by name. */
  private undoChange: Change | null = null;
  private undoMode: number | null = null;
  /** The volume the last change set, so undo can tell whether anyone moved it since. */
  private lastSetVolume: number | null = null;

  constructor(cfg: InstanceConfig, opts: InstanceOptions = {}) {
    this.cfg = cfg;
    this.client = opts.client ?? new HqpClient(cfg.host, { port: cfg.port });
    this.learned = opts.learned ?? new LearnedStore(null);
    this.timing = opts.timing ?? { quick: DEFAULT_TIMING, major: MAJOR_TIMING };
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async now(): Promise<Snapshot & { info: Info }> {
    const [info, state, status] = await Promise.all([this.client.info(), this.client.state(), this.client.status()]);
    return { info, state, status };
  }

  /**
   * Lists for the current mode. Cached per (engine, mode) and re-read when either
   * changes (design §2.5). Pass fresh=true to bypass the cache: writes always do,
   * because indices must be resolved at the moment of use (CLAUDE.md rule 5).
   */
  async capabilities(fresh = false): Promise<Capabilities> {
    const [info, state] = await Promise.all([this.client.info(), this.client.state()]);
    const key = `${info.engine}|${state.mode}`;
    if (!fresh && this.caps?.key === key) {
      // Learned failures can change without a mode change.
      return { ...this.caps.value, knownBad: this.learned.forInstance(this.cfg.id, info.engine, this.caps.value.mode.name) };
    }

    const [modes, filters, shapers, rates, volumeRange] = await Promise.all([
      this.client.modes(),
      this.client.filters(),
      this.client.shapers(),
      this.client.rates(),
      this.client.volumeRange(),
    ]);
    // The lists only mean anything for the mode they were read in.
    const after = await this.client.state();
    if (after.mode !== state.mode) throw new HttpError(409, "mode changed while reading lists; try again");
    const mode = modes.find((m) => m.index === state.mode);
    if (!mode) throw new HttpError(502, `State.mode ${state.mode} is not in GetModes`);

    const sdm = mode.name.startsWith("SDM");
    const cap = sdm ? this.cfg.limits?.maxDsdRate : this.cfg.limits?.maxPcmRate;
    const rateOptions: RateOption[] = rates.map((r) => {
      if (cap === undefined) return { ...r, allowed: true };
      if (r.rate === 0) return { ...r, allowed: true, note: `auto may pick a rate above this instance's limit` };
      return r.rate <= cap ? { ...r, allowed: true } : { ...r, allowed: false, note: `above this instance's limit (${cap} Hz)` };
    });

    const value: Capabilities = {
      engine: info.engine,
      mode,
      modes,
      filters,
      shapers,
      rates: rateOptions,
      rateSettable: mode.value !== -1,
      volumeRange,
      knownBad: this.learned.forInstance(this.cfg.id, info.engine, mode.name),
    };
    this.caps = { key, value };
    return value;
  }

  applyChange(change: Change): Promise<ApplyResult> {
    return this.exclusive(() => this.applyChangeNow(change, false));
  }

  undo(): Promise<ApplyResult> {
    return this.exclusive(async () => {
      if (!this.undoChange) throw new HttpError(409, "nothing to undo");
      const state = await this.client.state();
      if (state.mode !== this.undoMode) throw new HttpError(409, "mode changed since the last change; undo is not safe");
      return this.applyChangeNow(this.undoChange, true);
    });
  }

  private async applyChangeNow(change: Change, isUndo: boolean): Promise<ApplyResult> {
    const fields = (Object.keys(change) as Field[]).filter((k) => change[k] !== undefined);
    if (fields.length === 0) throw new HttpError(400, "empty change");

    const playingBefore = (await this.client.status()).state === 2;
    const applied = await this.applyFields(change, isUndo);
    const risky = fields.some((f) => RISKY.includes(f));
    const timing = applied.major ? this.timing.major : this.timing.quick;

    let playback: PlaybackCheck;
    if (!risky) playback = { kind: "not-checked", detail: "this change can't stop playback" };
    else if (!playingBefore) playback = { kind: "not-checked", detail: "nothing was playing, so playback couldn't be checked" };
    else playback = await this.watch(timing);

    if (playback.kind === "stopped" || playback.kind === "struggling") {
      // Never let bookkeeping (e.g. an unwritable config volume) block the rollback.
      await this.recordFailure(playback.detail).catch((e: Error) =>
        console.error(`could not record failed combination: ${e.message}`),
      );
      // Roll back. Volume follows the undo rule: restored only if nobody moved it.
      this.lastSetVolume = applied.volumeSet;
      const back = await this.applyFields(applied.prev, true);
      const recovered = await this.watch(this.timing.major);
      this.undoChange = null;
      this.lastSetVolume = null;
      return {
        class: applied.major ? "major" : "quick",
        results: applied.results,
        playback,
        rolledBack: { results: back.results, playback: recovered },
        state: back.state,
        undoAvailable: false,
      };
    }

    if (!isUndo) {
      this.undoChange = applied.prev;
      this.undoMode = applied.state.mode;
      this.lastSetVolume = applied.volumeSet;
    } else {
      this.undoChange = null;
      this.lastSetVolume = null;
    }
    return {
      class: applied.major ? "major" : "quick",
      results: applied.results,
      playback,
      rolledBack: null,
      state: applied.state,
      undoAvailable: this.undoChange !== null,
    };
  }

  /** Apply without watching. Returns read-back results and how to undo, by name. */
  private async applyFields(change: Change, isUndo: boolean) {
    const fields = (Object.keys(change) as Field[]).filter((k) => change[k] !== undefined);
    const caps0 = await this.capabilities(true);
    const before = await this.client.state();
    if (before.mode !== caps0.mode.index) throw new HttpError(409, "mode changed; try again");
    const was = settingsOf(caps0, before);
    const replies = new Map<Field, Outcome>();

    // ---- 1. mode first: every list changes with it ------------------------
    let caps = caps0;
    let modeSwitched = false;
    if (change.mode !== undefined && change.mode !== was.mode) {
      const m = caps0.modes.find((x) => x.name === change.mode);
      if (!m) throw new HttpError(422, `mode "${change.mode}" is not available on this instance`);
      replies.set("mode", await this.client.send(cmd.setMode(m.index)));
      caps = await this.capabilities(true);
      modeSwitched = caps.mode.name !== was.mode;
    }
    const undoModeSwitch = async () => {
      if (!modeSwitched) return;
      const m = caps.modes.find((x) => x.name === was.mode);
      if (m) await this.client.send(cmd.setMode(m.index));
    };

    // ---- 2. resolve everything else against the lists of the mode we're in --
    const problems: string[] = [];
    const resolve = <T extends { index: number; name: string }>(list: T[], field: Field, name?: string) => {
      if (name === undefined) return undefined;
      const hit = list.find((x) => x.name === name);
      if (!hit) problems.push(`${field}: "${name}" is not available in ${caps.mode.name} on engine ${caps.engine}`);
      return hit?.index;
    };
    let rateIdx: number | undefined;
    if (change.rate !== undefined) {
      const opt = caps.rates.find((r) => r.rate === change.rate);
      if (!caps.rateSettable) problems.push(`rate can't be set in ${caps.mode.name} mode`);
      else if (!opt) problems.push(`rate ${change.rate} Hz is not offered in ${caps.mode.name}`);
      else if (!opt.allowed) problems.push(`rate ${change.rate} Hz: ${opt.note}`);
      else rateIdx = opt.index;
    }
    const nx = resolve(caps.filters, "filterNx", change.filterNx);
    const x1 = resolve(caps.filters, "filter1x", change.filter1x);
    const shaper = resolve(caps.shapers, "shaper", change.shaper);

    // ---- 3. volume guards (design §7) ---------------------------------------
    let volume: number | undefined;
    let volumeNote: string | undefined;
    if (change.volume !== undefined) {
      const vr = caps.volumeRange;
      if (!vr.enabled) problems.push("volume control is disabled on this instance");
      else {
        volume = Math.max(vr.min, Math.min(vr.max, change.volume));
        if (volume !== change.volume) volumeNote = `clamped to ${volume} dB (range ${vr.min}…${vr.max})`;
        const raise = volume - before.volume;
        if (raise > MAX_RAISE_DB + VOLUME_EPS) {
          // Undo/rollback may return to the level the user was just listening at,
          // but only if nobody has moved the volume since our change.
          const untouched = this.lastSetVolume !== null && Math.abs(before.volume - this.lastSetVolume) <= VOLUME_EPS;
          if (!isUndo) problems.push(`refusing to raise volume by ${raise.toFixed(1)} dB in one step (max ${MAX_RAISE_DB} dB)`);
          else if (!untouched) {
            volume = undefined;
            volumeNote = `not restored: volume was changed elsewhere, and restoring would raise it by ${raise.toFixed(1)} dB`;
          }
        }
      }
    }

    if (problems.length) {
      await undoModeSwitch();
      throw new HttpError(422, problems.join("; "));
    }

    // ---- 4. apply in the design's order (§4.3) --------------------------------
    if (rateIdx !== undefined) replies.set("rate", await this.client.send(cmd.setRate(rateIdx)));
    if (nx !== undefined || x1 !== undefined) {
      // SetFilter always carries both indices; keep the one not being changed.
      const cur = modeSwitched ? await this.client.state() : before;
      const r = await this.client.send(cmd.setFilter(nx ?? cur.filterNx, x1 ?? cur.filter1x));
      if (nx !== undefined) replies.set("filterNx", r);
      if (x1 !== undefined) replies.set("filter1x", r);
    }
    if (shaper !== undefined) replies.set("shaper", await this.client.send(cmd.setShaping(shaper)));
    if (change.invert !== undefined) replies.set("invert", await this.client.send(cmd.setInvert(change.invert)));
    if (change.filter20k !== undefined) replies.set("filter20k", await this.client.send(cmd.set20kFilter(change.filter20k)));
    if (change.adaptive !== undefined) replies.set("adaptive", await this.client.send(cmd.setAdaptiveVolume(change.adaptive)));
    if (volume !== undefined) replies.set("volume", await this.client.send(cmd.volume(volume)));

    // ---- 5. read back: State is the verdict, not the reply (rule 4) ----------
    const after = await this.client.state();
    const now = settingsOf(caps, after);
    const results: FieldResult[] = fields.map((field) => {
      const reply = replies.get(field) ?? { kind: "none" as const };
      const requested = change[field]!;
      if (field === "volume") {
        return {
          field,
          requested,
          actual: now.volume,
          applied: volume !== undefined && Math.abs(now.volume - volume) <= VOLUME_EPS,
          reply,
          ...(volumeNote ? { note: volumeNote } : {}),
        };
      }
      return { field, requested, actual: now[field], applied: now[field] === requested, reply };
    });

    // ---- 6. how to undo, by name ----------------------------------------------
    const prev: Change = {};
    for (const f of fields) if (f !== "volume") (prev as Record<string, unknown>)[f] = was[f];
    // A mode switch resets the rate (reported) and swaps the remembered filters.
    if (modeSwitched) prev.rate = was.rate;
    if (volume !== undefined) prev.volume = was.volume;

    const major = modeSwitched || (rateIdx !== undefined && rateIdx !== before.rate);
    return { results, prev, state: after, volumeSet: volume ?? null, major };
  }

  /** Every failure learned on this instance, across engines and modes. */
  learnedFailures(): Failure[] {
    return this.learned.all(this.cfg.id);
  }

  forgetFailures(): { forgotten: number } {
    const n = this.learned.all(this.cfg.id).length;
    this.learned.forget(this.cfg.id);
    this.caps = null;
    return { forgotten: n };
  }

  private watch(timing: WatchTiming): Promise<Verdict> {
    return watchPlayback(async () => {
      const s = await this.client.status();
      return { state: s.state, position: s.position };
    }, timing);
  }

  private async recordFailure(reason: string) {
    const [caps, state, status] = await Promise.all([this.capabilities(true), this.client.state(), this.client.status()]);
    const s = settingsOf(caps, state);
    const combo: Combo = { mode: s.mode, rateHz: status.activeRate, filterNx: s.filterNx, filter1x: s.filter1x, shaper: s.shaper };
    this.learned.record({ ...combo, instance: this.cfg.id, engine: caps.engine, reason, at: new Date().toISOString() });
  }

  // ---- shared status poller (design §3: poll while someone is watching) ----

  private listeners = new Set<(e: { snapshot?: Snapshot; error?: string }) => void>();
  private timer: NodeJS.Timeout | null = null;

  subscribe(fn: (e: { snapshot?: Snapshot; error?: string }) => void, intervalMs = 1500): () => void {
    this.listeners.add(fn);
    if (!this.timer) {
      const tick = async () => {
        let event: { snapshot?: Snapshot; error?: string };
        try {
          const [status, state] = await Promise.all([this.client.status(), this.client.state()]);
          event = { snapshot: { status, state } };
        } catch (e) {
          event = { error: (e as Error).message };
        }
        for (const l of this.listeners) l(event);
      };
      void tick();
      this.timer = setInterval(tick, intervalMs);
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  close() {
    this.client.close();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
