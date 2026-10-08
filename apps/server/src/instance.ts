// One HQPlayer instance: a thin front over its parts. It keeps the capability cache and
// runs writes one at a time; changes, rollback and undo are the change engine's
// (change-engine.ts), the live status stream is the poller's (poller.ts).
import {
  HqpClient,
  cmd,
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
import { LearnedStore, type Combo, type Failure, type KeptUp } from "./learned.ts";
import { KEPT_TIMING, KeptUpTracker, type KeptTiming } from "./kept-up.ts";
import { HistoryStore, changedFields, type ChangeSource } from "./history.ts";
import { MeterStream, type MeterEvent, type MeterTiming } from "./meter-stream.ts";
import { DEFAULT_TIMING, MAJOR_TIMING, type Verdict, type WatchTiming } from "./watch.ts";
import { previewOne, type PresetPreview } from "./preset-preview.ts";
import { settingsOf, type Settings } from "./settings.ts";
import { StatusPoller, type Snapshot, type StatusEvent } from "./poller.ts";
import { ChangeEngine, type RoonTransport } from "./change-engine.ts";
import { HttpError } from "./errors.ts";
import { activeDac, scopeOf } from "./dac-scope.ts";

export type { Snapshot, StatusEvent, VolumeJump } from "./poller.ts";
export { HttpError } from "./errors.ts";
export { RISKY } from "./change-engine.ts";

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
  /** Combinations that kept up here, settled, with how fast (kept-up.ts). */
  keptUp: KeptUp[];
  /** Each mode's settings as hqpweb last saw them, for the DAC in use (history.ts). */
  lastSeen: ReturnType<HistoryStore["lastSeen"]>;
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

/** What a kept-up session is about: DAC scope, engine, combination and source rate. */
type KeptKey = Combo & { instance: string; engine: string; sourceRate: number };

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
  /** Roon's transport for this instance's zone, when Roon is on and linked (change-engine.ts). */
  roon?: () => RoonTransport | null;
  /** When a playing combination counts as settled (kept-up.ts). Default KEPT_TIMING; tests shorten it. */
  keptTiming?: KeptTiming;
  /** Change history and settings last seen per mode (history.ts). Default: in memory. */
  history?: HistoryStore;
  /** Meter stream timing (meter-stream.ts); tests shorten it. */
  meterTiming?: Partial<MeterTiming>;
}

export class Instance {
  readonly cfg: InstanceConfig;
  readonly client: HqpClient;
  private readonly learned: LearnedStore;
  /** Applies changes, checks playback, rolls back, and keeps the undo. */
  private readonly engine: ChangeEngine;
  /** The live status stream, shared by everyone watching this instance. */
  private readonly poller: StatusPoller;
  private readonly playWaitMs: number;
  private caps: { key: string; value: Capabilities } | null = null;
  /** Writes to one instance run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  constructor(cfg: InstanceConfig, opts: InstanceOptions = {}) {
    this.cfg = cfg;
    this.client = opts.client ?? new HqpClient(cfg.host, { port: cfg.port });
    this.learned = opts.learned ?? new LearnedStore(null);
    this.kept = new KeptUpTracker(opts.keptTiming ?? KEPT_TIMING);
    this.history = opts.history ?? new HistoryStore(null);
    this.meterTiming = opts.meterTiming ?? {};
    this.poller = new StatusPoller(this.client, {
      speedWindowMs: opts.speedWindowMs ?? 30_000,
      queueEveryMs: opts.queueEveryMs ?? 5000,
      ownWrites: () => ({ count: this.started, active: this.running > 0 }),
      onTick: (status, state) => {
        void this.noteSpeed(status, state).catch(() => undefined);
        void this.noteSettings(state).catch(() => undefined);
      },
    });
    this.playWaitMs = opts.playWaitMs ?? 5000;
    this.engine = new ChangeEngine({
      client: this.client,
      capabilities: (fresh) => this.capabilities(fresh),
      learned: this.learned,
      scope: () => this.scope(),
      timing: opts.timing ?? { quick: DEFAULT_TIMING, major: MAJOR_TIMING },
      onVolumeWrite: (v) => this.poller.noteOwnVolume(v),
      ...(opts.roon ? { roon: opts.roon } : {}),
    });
  }

  /**
   * "Kept up here" (kept-up.ts): while something plays and no change is running, feed
   * HQPlayer's processing speed to the tracker, keyed by DAC, combination and source
   * rate, and record what it settles on. Only while someone is watching (the poller
   * runs then), so hqpweb learns this as it's used.
   */
  private readonly kept: KeptUpTracker;
  private async noteSpeed(status: Status, state: State) {
    const t = Date.now();
    const playing = status.state === 2 && !this.busy && status.source && (status.processSpeed ?? 0) > 0;
    let result;
    if (!playing) result = this.kept.feed({ t, key: null, speed: null });
    else {
      const caps = await this.capabilities();
      const s = settingsOf(caps, state);
      const sample: KeptKey = {
        instance: this.scope(),
        engine: caps.engine,
        sourceRate: status.source!.sampleRate,
        mode: s.mode,
        rateHz: status.activeRate,
        filterNx: s.filterNx,
        filter1x: s.filter1x,
        shaper: s.shaper,
      };
      result = this.kept.feed({ t, key: JSON.stringify(sample), speed: status.processSpeed });
    }
    if (!result) return;
    const k = JSON.parse(result.key) as KeptKey;
    this.learned.recordKept({ ...k, low: result.low, typical: result.typical, at: new Date(t).toISOString() }, result.final);
  }

  private readonly history: HistoryStore;
  /** The settings at the previous poll, to spot changes made elsewhere. */
  private baseline: { scope: string; settings: Settings } | null = null;
  /** Bumped by every write hqpweb makes, so a poll that overlapped one is ignored. */
  private writes = 0;

  /**
   * Each poll: keep the settings as last seen in this mode, and log any change since
   * the last poll that hqpweb didn't make (HQPlayer's own window, another app). Polls
   * during or overlapping hqpweb's own writes are skipped; each write leaves the
   * settings it ended with as the baseline, so a change made right after it still shows.
   */
  private async noteSettings(state: State) {
    const gen = this.writes;
    if (this.busy) return;
    const caps = await this.capabilities();
    // A poll that overlapped one of hqpweb's writes saw a moment in between: ignore it
    // (the write sets the next baseline itself).
    if (caps.mode.index !== state.mode || gen !== this.writes || this.busy) return;
    const scope = this.scope();
    const now = settingsOf(caps, state);
    const at = new Date().toISOString();
    this.history.seen(scope, now, at);
    const prev = this.baseline;
    this.baseline = { scope, settings: now };
    if (!prev || prev.scope !== scope) return;
    const changes = changedFields(prev.settings, now);
    if (changes.length) this.history.push({ at, instance: scope, source: "elsewhere", changes });
  }

  /** Runs one of hqpweb's own changes and logs it, with the settings before and after. */
  private logged(source: ChangeSource, run: () => Promise<ApplyResult>): Promise<ApplyResult> {
    return this.exclusive(async () => {
      this.writes++;
      const scope = this.scope();
      const before = await this.currentSettings().catch(() => null);
      let r: ApplyResult;
      try {
        r = await run();
      } finally {
        const after = await this.currentSettings().catch(() => null);
        this.baseline = after ? { scope: this.scope(), settings: after } : null;
        this.writes++;
      }
      // Volume is left out, as for changes made elsewhere (history.ts): taps aren't history.
      const changes = r.results
        .filter((x) => x.field !== "volume")
        .map((x) => ({ field: x.field, from: before?.[x.field], to: x.actual, applied: x.applied }));
      if (before && changes.length)
        this.history.push({
          at: new Date().toISOString(),
          instance: scope,
          source,
          changes,
          playback: r.playback.kind,
          ...("detail" in r.playback && r.playback.detail ? { detail: r.playback.detail } : {}),
          ...(r.rolledBack ? { rolledBack: true } : {}),
        });
      return r;
    });
  }

  /** hqpweb's change history for this instance and its DACs, newest first. */
  changeHistory() {
    return this.history.forInstance(this.cfg.id);
  }

  /** Where this instance's failures and answers are kept now: its id, or `id#dac` (dac-scope.ts). */
  scope(): string {
    return scopeOf(this.cfg.id, activeDac(this.cfg));
  }

  private running = 0;
  /** Writes started so far (the poller's backoff ignores slow replies that overlapped one). */
  private started = 0;
  /** A change (or another write) is in progress: the DAC in use mustn't be switched under it. */
  get busy(): boolean {
    return this.running > 0;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const counted = async () => {
      this.started++;
      this.running++;
      try {
        return await fn();
      } finally {
        this.running--;
      }
    };
    const run = this.queue.then(counted, counted);
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
      return {
        ...this.caps.value,
        knownBad: this.learned.forInstance(this.scope(), info.engine, this.caps.value.mode.name),
        keptUp: this.learned.keptFor(this.scope(), info.engine, this.caps.value.mode.name),
        lastSeen: this.history.lastSeen(this.scope()),
      };
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
      knownBad: this.learned.forInstance(this.scope(), info.engine, mode.name),
      keptUp: this.learned.keptFor(this.scope(), info.engine, mode.name),
      lastSeen: this.history.lastSeen(this.scope()),
    };
    this.caps = { key, value };
    return value;
  }

  applyChange(change: Change): Promise<ApplyResult> {
    return this.logged("hqpweb", () => this.engine.apply(this.withModeRate(change), false));
  }

  /**
   * A mode switch brings back that mode's filters and shaping, but resets the rate to
   * auto, which in DSD is the highest rate (measured 2026-10-08, Desktop 5.35.10). A
   * modulator that kept up at DSD256 then fell behind at DSD1024 and was rolled back on
   * every attempt: no way back into DSD. So a switch that names no rate takes the mode's
   * last-seen fixed rate for the DAC in use (history.ts), set while still paused.
   */
  private withModeRate(change: Change): Change {
    if (change.mode === undefined || change.rate !== undefined) return change;
    const rate = this.history.lastSeen(this.scope())[change.mode]?.rate;
    return rate ? { ...change, rate } : change;
  }

  /**
   * Apply a preset: like applyChange, but settings this instance can't take
   * (a name missing in this mode or engine, a rate it doesn't offer, a volume
   * raise past the guard) are skipped and reported instead of failing it all.
   */
  applyPreset(settings: Change): Promise<ApplyResult> {
    return this.logged("preset", () => this.engine.apply(this.withModeRate(settings), false, true));
  }

  undo(): Promise<ApplyResult> {
    return this.logged("undo", () => this.engine.undo());
  }

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
    const why = await this.engine.explain().catch(() => undefined);
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

  subscribe(fn: (e: StatusEvent) => void, intervalMs = 1000): () => void {
    return this.poller.subscribe(fn, intervalMs);
  }
  dismissVolumeJump() {
    return this.poller.dismissVolumeJump();
  }

  /** HQPlayer's meter, while someone watches it (meter-stream.ts). */
  private meter: MeterStream | null = null;
  private readonly meterTiming: Partial<MeterTiming>;
  subscribeMeter(fn: (e: MeterEvent) => void): () => void {
    this.meter ??= new MeterStream(this.cfg.host, this.cfg.meterPort ?? this.cfg.port + 1, this.meterTiming);
    return this.meter.subscribe(fn);
  }

  close() {
    this.client.close();
    this.poller.close();
    this.meter?.close();
  }
}
