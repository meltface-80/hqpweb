// One HQPlayer instance: capability cache, quick changes with read-back
// verification, undo, and a shared status poller. Mode and rate ("major"
// changes, design §4.2) are deliberately not here yet: they need rollback.
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

export interface Capabilities {
  engine: string;
  mode: Mode;
  modes: Mode[];
  filters: Filter[];
  shapers: Shaper[];
  rates: Rate[];
  volumeRange: VolumeRange;
}

/** A quick change, by NAME (never index), design §4.3. Every field optional. */
export interface QuickChange {
  filterNx?: string;
  filter1x?: string;
  shaper?: string;
  volume?: number;
  invert?: boolean;
  filter20k?: boolean;
  adaptive?: boolean;
}
export type QuickField = keyof QuickChange;

export interface FieldResult {
  field: QuickField;
  requested: string | number | boolean;
  /** What State reports afterwards, translated back to a name where relevant. */
  actual: string | number | boolean;
  /** Whether State shows the requested value. This, not the reply, is the verdict. */
  applied: boolean;
  /** The command's own reply, for diagnostics only. */
  reply: Outcome;
  note?: string;
}

export interface ApplyResult {
  results: FieldResult[];
  state: State;
  undoAvailable: boolean;
}

export interface Snapshot {
  status: Status;
  state: State;
}

const nameOf = <T extends { index: number; name: string }>(list: T[], i: number) =>
  list.find((x) => x.index === i)?.name ?? `#${i}`;

export class Instance {
  readonly cfg: InstanceConfig;
  readonly client: HqpClient;
  private caps: { key: string; value: Capabilities } | null = null;
  /** Writes to one instance run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The previous values of the fields the last change touched, by name. */
  private undoChange: QuickChange | null = null;
  private undoMode: number | null = null;
  /** The volume the last change set, so undo can tell whether anyone moved it since. */
  private lastSetVolume: number | null = null;

  constructor(cfg: InstanceConfig, client = new HqpClient(cfg.host, { port: cfg.port })) {
    this.cfg = cfg;
    this.client = client;
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
    if (!fresh && this.caps?.key === key) return this.caps.value;

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
    const value = { engine: info.engine, mode, modes, filters, shapers, rates, volumeRange };
    this.caps = { key, value };
    return value;
  }

  applyQuick(change: QuickChange, opts: { isUndo?: boolean } = {}): Promise<ApplyResult> {
    return this.exclusive(() => this.applyQuickNow(change, opts.isUndo ?? false));
  }

  undo(): Promise<ApplyResult> {
    return this.exclusive(async () => {
      if (!this.undoChange) throw new HttpError(409, "nothing to undo");
      const state = await this.client.state();
      if (state.mode !== this.undoMode) throw new HttpError(409, "mode changed since the last change; undo is not safe");
      return this.applyQuickNow(this.undoChange, true);
    });
  }

  private async applyQuickNow(change: QuickChange, isUndo: boolean): Promise<ApplyResult> {
    const fields = (Object.keys(change) as QuickField[]).filter((k) => change[k] !== undefined);
    if (fields.length === 0) throw new HttpError(400, "empty change");

    const caps = await this.capabilities(true);
    const before = await this.client.state();
    if (before.mode !== caps.mode.index) throw new HttpError(409, "mode changed; try again");

    // ---- resolve names to indices against the lists just read ------------
    const missing: string[] = [];
    const resolve = <T extends { index: number; name: string }>(list: T[], field: QuickField, name?: string) => {
      if (name === undefined) return undefined;
      const hit = list.find((x) => x.name === name);
      if (!hit) missing.push(`${field}: "${name}" is not available in ${caps.mode.name} on engine ${caps.engine}`);
      return hit?.index;
    };
    const nx = resolve(caps.filters, "filterNx", change.filterNx);
    const x1 = resolve(caps.filters, "filter1x", change.filter1x);
    const shaper = resolve(caps.shapers, "shaper", change.shaper);
    if (missing.length) throw new HttpError(422, missing.join("; "));

    // ---- volume guards (design §7) ------------------------------------------
    let volume: number | undefined;
    let volumeNote: string | undefined;
    if (change.volume !== undefined) {
      const vr = caps.volumeRange;
      if (!vr.enabled) throw new HttpError(422, "volume control is disabled on this instance");
      if (!Number.isFinite(change.volume)) throw new HttpError(400, "volume must be a finite number of dB");
      volume = Math.max(vr.min, Math.min(vr.max, change.volume));
      if (volume !== change.volume) volumeNote = `clamped to ${volume} dB (range ${vr.min}…${vr.max})`;
      const raise = volume - before.volume;
      if (raise > MAX_RAISE_DB + VOLUME_EPS) {
        if (!isUndo)
          throw new HttpError(422, `refusing to raise volume by ${raise.toFixed(1)} dB in one step (max ${MAX_RAISE_DB} dB)`);
        // Undo may return to the level the user was just listening at, but only if
        // nobody has moved the volume since our change. Otherwise leave it alone.
        const untouched = this.lastSetVolume !== null && Math.abs(before.volume - this.lastSetVolume) <= VOLUME_EPS;
        if (!untouched) {
          volume = undefined;
          volumeNote = `not restored: volume was changed elsewhere, and restoring would raise it by ${raise.toFixed(1)} dB`;
        }
      }
    }

    // ---- remember how to undo, by name --------------------------------------
    const prev: QuickChange = {};
    if (nx !== undefined || x1 !== undefined) {
      if (nx !== undefined) prev.filterNx = nameOf(caps.filters, before.filterNx);
      if (x1 !== undefined) prev.filter1x = nameOf(caps.filters, before.filter1x);
    }
    if (shaper !== undefined) prev.shaper = nameOf(caps.shapers, before.shaper);
    if (volume !== undefined) prev.volume = before.volume;
    if (change.invert !== undefined) prev.invert = before.invert;
    if (change.filter20k !== undefined) prev.filter20k = before.filter20k;
    if (change.adaptive !== undefined) prev.adaptive = before.adaptive;

    // ---- apply, in the design's order (§4.3): filters, shaper, toggles, volume
    const replies = new Map<QuickField, Outcome>();
    if (nx !== undefined || x1 !== undefined) {
      // SetFilter always carries both indices; keep the one not being changed.
      const r = await this.client.send(cmd.setFilter(nx ?? before.filterNx, x1 ?? before.filter1x));
      if (nx !== undefined) replies.set("filterNx", r);
      if (x1 !== undefined) replies.set("filter1x", r);
    }
    if (shaper !== undefined) replies.set("shaper", await this.client.send(cmd.setShaping(shaper)));
    if (change.invert !== undefined) replies.set("invert", await this.client.send(cmd.setInvert(change.invert)));
    if (change.filter20k !== undefined) replies.set("filter20k", await this.client.send(cmd.set20kFilter(change.filter20k)));
    if (change.adaptive !== undefined) replies.set("adaptive", await this.client.send(cmd.setAdaptiveVolume(change.adaptive)));
    if (volume !== undefined) replies.set("volume", await this.client.send(cmd.volume(volume)));

    // ---- read back: State is the verdict, not the reply (rule 4) -------------
    const after = await this.client.state();
    const results: FieldResult[] = fields.map((field) => {
      const reply = replies.get(field) ?? { kind: "none" as const };
      switch (field) {
        case "filterNx":
          return { field, requested: change.filterNx!, actual: nameOf(caps.filters, after.filterNx), applied: after.filterNx === nx, reply };
        case "filter1x":
          return { field, requested: change.filter1x!, actual: nameOf(caps.filters, after.filter1x), applied: after.filter1x === x1, reply };
        case "shaper":
          return { field, requested: change.shaper!, actual: nameOf(caps.shapers, after.shaper), applied: after.shaper === shaper, reply };
        case "volume":
          return {
            field,
            requested: change.volume!,
            actual: after.volume,
            applied: volume !== undefined && Math.abs(after.volume - volume) <= VOLUME_EPS,
            reply,
            ...(volumeNote ? { note: volumeNote } : {}),
          };
        default:
          return { field, requested: change[field]!, actual: after[field], applied: after[field] === change[field], reply };
      }
    });

    if (!isUndo) {
      this.undoChange = prev;
      this.undoMode = before.mode;
      this.lastSetVolume = volume ?? null;
    } else {
      this.undoChange = null;
      this.lastSetVolume = null;
    }
    return { results, state: after, undoAvailable: this.undoChange !== null };
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
