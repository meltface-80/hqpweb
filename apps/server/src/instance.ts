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
  queuedRate,
  filterSlot,
  predictedStop,
  type Hint,
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
import { decideVolume, VOLUME_EPS } from "./volume.ts";
import { MODE_BOUND, previewOne, type PresetPreview } from "./preset-preview.ts";
import { settingsOf } from "./settings.ts";
import { StatusPoller, type Snapshot, type StatusEvent } from "./poller.ts";

export type { Snapshot, StatusEvent, VolumeJump } from "./poller.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export { MAX_RAISE_DB } from "./volume.ts";

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
  /** On/off only: impulse responses can't be configured over the control API. */
  convolution?: boolean;
  /** A matrix profile already set up in HQPlayer, by name. */
  matrixProfile?: string;
}
export type Field = keyof Change;

/** Fields whose change can stop playback or overload the machine. */
export const RISKY: readonly Field[] = ["mode", "rate", "filterNx", "filter1x", "shaper", "convolution", "matrixProfile"];

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
  /** Matrix profiles set up in HQPlayer (may be empty). */
  matrixProfiles: string[];
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
  /**
   * Set when HQPlayer's own rules explain the failure (e.g. a filter that needs a
   * whole-number ratio). Such failures are not learned as this machine's limits.
   */
  incompatible?: Hint;
  /** Lenient applies (presets): settings this instance couldn't take, and why. */
  skipped?: { field: Field; reason: string }[];
  state: State;
  undoAvailable: boolean;
}

export const TRANSPORT_ACTIONS = ["play", "pause", "stop", "previous", "next"] as const;
export type TransportAction = (typeof TRANSPORT_ACTIONS)[number];

export interface InstanceOptions {
  client?: HqpClient;
  learned?: LearnedStore;
  timing?: { quick: WatchTiming; major: WatchTiming };
  /** Window for the live playback-speed health signal. Default 30 s; tests shorten it. */
  speedWindowMs?: number;
  /** How often to re-read the playlist while stopped. Default 5 s; tests shorten it. */
  queueEveryMs?: number;
  /** How long to wait for Play to take before saying it didn't. Default 5 s. */
  playWaitMs?: number;
}

export class Instance {
  readonly cfg: InstanceConfig;
  readonly client: HqpClient;
  private readonly learned: LearnedStore;
  private readonly timing: { quick: WatchTiming; major: WatchTiming };
  /** The live status stream, shared by everyone watching this instance. */
  private readonly poller: StatusPoller;
  private readonly playWaitMs: number;
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
    this.poller = new StatusPoller(this.client, {
      speedWindowMs: opts.speedWindowMs ?? 30_000,
      queueEveryMs: opts.queueEveryMs ?? 5000,
    });
    this.playWaitMs = opts.playWaitMs ?? 5000;
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

    const [modes, filters, shapers, rates, volumeRange, matrixProfiles] = await Promise.all([
      this.client.modes(),
      this.client.filters(),
      this.client.shapers(),
      this.client.rates(),
      this.client.volumeRange(),
      this.client.matrixProfiles().catch(() => [] as string[]),
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
      matrixProfiles,
      knownBad: this.learned.forInstance(this.cfg.id, info.engine, mode.name),
    };
    this.caps = { key, value };
    return value;
  }

  applyChange(change: Change): Promise<ApplyResult> {
    return this.exclusive(() => this.applyChangeNow(change, false));
  }

  /**
   * Apply a preset: like applyChange, but settings this instance can't take
   * (a name missing in this mode or engine, a rate it doesn't offer, a volume
   * raise past the guard) are skipped and reported instead of failing it all.
   */
  applyPreset(settings: Change): Promise<ApplyResult> {
    return this.exclusive(() => this.applyChangeNow(settings, false, true));
  }

  undo(): Promise<ApplyResult> {
    return this.exclusive(async () => {
      if (!this.undoChange) throw new HttpError(409, "nothing to undo");
      const state = await this.client.state();
      if (state.mode !== this.undoMode) throw new HttpError(409, "mode changed since the last change; undo is not safe");
      return this.applyChangeNow(this.undoChange, true);
    });
  }

  private async applyChangeNow(change: Change, isUndo: boolean, lenient = false): Promise<ApplyResult> {
    const fields = (Object.keys(change) as Field[]).filter((k) => change[k] !== undefined);
    if (fields.length === 0) throw new HttpError(400, "empty change");

    const playingBefore = (await this.client.status()).state === 2;
    const applied = await this.applyFields(change, isUndo, lenient);
    const skipped = applied.skipped.length ? { skipped: applied.skipped } : {};
    const risky = applied.results.some((r) => RISKY.includes(r.field));
    const timing = applied.major ? this.timing.major : this.timing.quick;

    let playback: PlaybackCheck;
    if (!risky) playback = { kind: "not-checked", detail: "this change can't stop playback" };
    else if (!playingBefore) playback = { kind: "not-checked", detail: "nothing was playing, so playback couldn't be checked" };
    else playback = await this.watch(timing);

    if (playback.kind === "stopped" || playback.kind === "struggling") {
      // A rule-explained stop is HQPlayer's design, not this machine's limit: don't learn it.
      const incompatible = await this.explain().catch(() => undefined);
      // Never let bookkeeping (e.g. an unwritable config volume) block the rollback.
      if (!incompatible)
        await this.recordFailure(playback.detail).catch((e: Error) =>
          console.error(`could not record failed combination: ${e.message}`),
        );
      // Roll back. Volume is only ever lowered: nobody asked for a raise (volume.ts).
      // Lenient: restore what can be restored even if a name has vanished (e.g.
      // HQPlayer restarted on its saved settings). Undo is cleared whatever
      // happens, so it can never point at the wrong change.
      this.lastSetVolume = applied.volumeSet;
      this.undoChange = null;
      let back: { results: FieldResult[]; state: State };
      let recovered: PlaybackCheck;
      try {
        back = await this.applyFields(applied.prev, true, true, true);
        recovered = await this.watch(this.timing.major);
      } catch (e) {
        back = { results: [], state: await this.client.state() };
        recovered = { kind: "inconclusive", detail: `couldn't roll back: ${(e as Error).message}` };
      } finally {
        this.lastSetVolume = null;
      }
      return {
        class: applied.major ? "major" : "quick",
        results: applied.results,
        playback,
        rolledBack: { results: back.results, playback: recovered },
        state: back.state,
        undoAvailable: false,
        ...(incompatible ? { incompatible } : {}),
        ...skipped,
      };
    }

    if (applied.results.length === 0) {
      // Nothing could be applied: leave undo as it was.
    } else if (!isUndo) {
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
      ...skipped,
    };
  }

  /** Apply without watching. Returns read-back results and how to undo, by name. */
  private async applyFields(change: Change, isUndo: boolean, lenient = false, rollback = false) {
    const requestedFields = (Object.keys(change) as Field[]).filter((k) => change[k] !== undefined);
    const problems: { field: Field; reason: string }[] = [];
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
      if (!m) {
        if (!lenient) throw new HttpError(422, `mode "${change.mode}" is not available on this instance`);
        problems.push({ field: "mode", reason: `mode "${change.mode}" is not available on this instance` });
        // Rate, filters and modulator/dither were chosen for that mode: don't apply them to this one.
        for (const f of MODE_BOUND)
          if (change[f] !== undefined) problems.push({ field: f, reason: `belongs to mode "${change.mode}"` });
      } else {
        replies.set("mode", await this.client.send(cmd.setMode(m.index)));
        caps = await this.capabilities(true);
        modeSwitched = caps.mode.name !== was.mode;
      }
    }
    const undoModeSwitch = async () => {
      if (!modeSwitched) return;
      const m = caps.modes.find((x) => x.name === was.mode);
      if (m) await this.client.send(cmd.setMode(m.index));
    };

    // ---- 2. resolve everything else against the lists of the mode we're in --
    const alreadySkipped = (f: Field) => problems.some((p) => p.field === f);
    const resolve = <T extends { index: number; name: string }>(list: T[], field: Field, name?: string) => {
      if (name === undefined || alreadySkipped(field)) return undefined;
      const hit = list.find((x) => x.name === name);
      if (!hit) problems.push({ field, reason: `"${name}" is not available in ${caps.mode.name} on engine ${caps.engine}` });
      return hit?.index;
    };
    let rateIdx: number | undefined;
    if (change.rate !== undefined && !alreadySkipped("rate")) {
      const opt = caps.rates.find((r) => r.rate === change.rate);
      const p = (reason: string) => problems.push({ field: "rate", reason });
      if (!caps.rateSettable) p(`rate can't be set in ${caps.mode.name} mode`);
      else if (!opt) p(`${change.rate} Hz is not offered in ${caps.mode.name}`);
      else if (!opt.allowed) p(`${change.rate} Hz: ${opt.note}`);
      else rateIdx = opt.index;
    }
    const nx = resolve(caps.filters, "filterNx", change.filterNx);
    const x1 = resolve(caps.filters, "filter1x", change.filter1x);
    const shaper = resolve(caps.shapers, "shaper", change.shaper);
    // HQPlayer accepts unknown profile names with OK (reported), so only send listed ones.
    // Undo/rollback may restore "" (no profile active); read-back verifies it took.
    const restoringNone = isUndo && change.matrixProfile === "";
    if (change.matrixProfile !== undefined && !restoringNone && !caps.matrixProfiles.includes(change.matrixProfile))
      problems.push({
        field: "matrixProfile",
        reason: caps.matrixProfiles.length
          ? `"${change.matrixProfile}" is not one of this instance's matrix profiles`
          : "no matrix profiles are set up in HQPlayer on this instance",
      });

    // ---- 3. volume guards (design §7; rules in volume.ts) --------------------
    let volume: number | undefined;
    let volumeNote: string | undefined;
    if (change.volume !== undefined) {
      const untouched = this.lastSetVolume !== null && Math.abs(before.volume - this.lastSetVolume) <= VOLUME_EPS;
      const kind = rollback ? "rollback" : isUndo ? "undo" : "change";
      const d = decideVolume({ requested: change.volume, current: before.volume, range: caps.volumeRange, kind, untouched });
      volume = d.set;
      volumeNote = d.note;
      if (d.problem) problems.push({ field: "volume", reason: d.problem });
    }

    if (problems.length && !lenient) {
      await undoModeSwitch();
      throw new HttpError(422, problems.map((p) => (p.field === "volume" ? p.reason : `${p.field}: ${p.reason}`)).join("; "));
    }
    const skippedFields = new Set(problems.map((p) => p.field));
    const fields = requestedFields.filter((f) => !skippedFields.has(f));

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
    if (change.convolution !== undefined && fields.includes("convolution"))
      replies.set("convolution", await this.client.send(cmd.setConvolution(change.convolution)));
    if (change.matrixProfile !== undefined && fields.includes("matrixProfile"))
      replies.set("matrixProfile", await this.client.send(cmd.matrixSetProfile(change.matrixProfile)));
    if (volume !== undefined) {
      this.poller.noteOwnVolume(volume);
      replies.set("volume", await this.client.send(cmd.volume(volume)));
    }

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
      const applied = now[field] === requested;
      // Measured: with no impulse responses set up, SetConvolution says OK and nothing changes.
      const note =
        field === "convolution" && requested === true && !applied
          ? "HQPlayer didn't enable convolution: no impulse responses are set up there (Convolution → Engine setup in HQPlayer; not possible remotely)"
          : undefined;
      return { field, requested, actual: now[field], applied, reply, ...(note ? { note } : {}) };
    });

    // ---- 6. how to undo, by name ----------------------------------------------
    const prev: Change = {};
    for (const f of fields) if (f !== "volume") (prev as Record<string, unknown>)[f] = was[f];
    // A mode switch resets the rate (reported) and swaps the remembered filters.
    if (modeSwitched) prev.rate = was.rate;
    if (volume !== undefined) prev.volume = was.volume;

    const major = modeSwitched || (rateIdx !== undefined && rateIdx !== before.rate);
    return { results, prev, state: after, volumeSet: volume ?? null, major, skipped: problems };
  }

  /**
   * Transport: play, pause, stop, previous, next. When Roon drives HQPlayer these
   * act underneath Roon, which may or may not follow. Measured: Play doesn't
   * restart an instance stalled by an invalid combination.
   */
  async transport(action: TransportAction): Promise<{ reply: Outcome; status: Status; notStarted?: { explained?: string } }> {
    const { reply, status: first } = await this.exclusive(async () => {
      const reply = await this.client.send(cmd[action]());
      // Give the engine a moment, then report what actually happened.
      await new Promise((r) => setTimeout(r, 300));
      return { reply, status: await this.client.status() };
    });
    let status = first;
    if (action !== "play" || status.state === 2) return { reply, status };
    // Measured: Play is "OK" even when nothing can start (a ratio HQPlayer can't do,
    // or an output that isn't there). Wait a little, outside the write lock so a Stop
    // or a volume change never queues behind it, then say so, and why if a rule does.
    for (let waited = 0; waited < this.playWaitMs && status.state !== 2; waited += 400) {
      await new Promise((r) => setTimeout(r, 400));
      status = await this.client.status();
    }
    if (status.state === 2) return { reply, status };
    const why = await this.explain().catch(() => undefined);
    return { reply, status, notStarted: why ? { explained: why.text } : {} };
  }

  /**
   * Jump within the current track. HQPlayer refuses on an unseekable source (a Roon
   * stream, or HTTP without range support) with a real error, which is passed on.
   */
  seek(seconds: number): Promise<{ status: Status }> {
    return this.exclusive(async () => {
      const reply = await this.client.send(cmd.seek(seconds));
      if (reply.kind === "error") throw new HttpError(409, `HQPlayer can't seek here: ${reply.message}`);
      await new Promise((r) => setTimeout(r, 300));
      return { status: await this.client.status() };
    });
  }

  /** Current settings, by name: what "save current as preset" captures. */
  async currentSettings(): Promise<Required<Change>> {
    const [caps, state] = await Promise.all([this.capabilities(true), this.client.state()]);
    return settingsOf(caps, state);
  }

  /**
   * How presets relate to this instance right now, from one set of reads. Names
   * can only be checked against the current mode's lists; a preset for another
   * mode is checked when applied.
   */
  async previewPresets(list: Change[]): Promise<PresetPreview[]> {
    const [caps, state, status] = await Promise.all([this.capabilities(), this.client.state(), this.client.status()]);
    const cur = settingsOf(caps, state);
    return list.map((p) => previewOne(p, caps, cur, status));
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

  /** Does a known HQPlayer rule explain why the current settings can't play? */
  private async explain(): Promise<Hint | undefined> {
    const [caps, state, status] = await Promise.all([this.capabilities(true), this.client.state(), this.client.status()]);
    // A track that can't start has no source in Status (measured): use the queued one.
    const source =
      status.source?.sampleRate ??
      (await this.client
        .request(cmd.playlistGet())
        .then((el) => queuedRate(el, status.track))
        .catch(() => null));
    if (!source) return undefined;
    const s = settingsOf(caps, state);
    const filter = filterSlot(source) === "1x" ? s.filter1x : s.filterNx;
    return predictedStop({
      mode: s.mode,
      filter,
      shaper: s.shaper,
      sourceRate: source,
      outputRate: status.activeRate,
      filterDescription: caps.filters.find((f) => f.name === filter)?.description,
    });
  }

  private async recordFailure(reason: string) {
    const [caps, state, status] = await Promise.all([this.capabilities(true), this.client.state(), this.client.status()]);
    const s = settingsOf(caps, state);
    const combo: Combo = {
      mode: s.mode,
      rateHz: status.activeRate,
      filterNx: s.filterNx,
      filter1x: s.filter1x,
      shaper: s.shaper,
    };
    this.learned.record({ ...combo, instance: this.cfg.id, engine: caps.engine, reason, at: new Date().toISOString() });
  }

  subscribe(fn: (e: StatusEvent) => void, intervalMs = 1000): () => void {
    return this.poller.subscribe(fn, intervalMs);
  }
  dismissVolumeJump() {
    return this.poller.dismissVolumeJump();
  }

  close() {
    this.client.close();
    this.poller.close();
  }
}
