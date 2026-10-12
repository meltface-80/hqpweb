// The shapes Instance deals in, shared with app.ts, the change engine and tests: a change by
// name, what an instance offers, and what applying a change found. Split from instance.ts.
import type { Filter, Hint, Mode, Outcome, Rate, Shaper, State, VolumeRange } from "@app/protocol";
import type { HistoryStore } from "./history.ts";
import type { Failure, KeptUp, SlowSwitch } from "./learned.ts";
import type { WatchResult } from "./watch.ts";

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
  /** HQPlayer's DAC correction is running: knownBad, keptUp and slowSwitches are what applies in that state. */
  correction: boolean;
  /** Combinations that failed here before, for this engine and mode. */
  knownBad: Failure[];
  /** Combinations that kept up here, settled, with how fast (kept-up.ts). */
  keptUp: KeptUp[];
  /** Filters HQPlayer was slow to switch to here (learned.ts SlowSwitch). */
  slowSwitches: SlowSwitch[];
  /** Each mode's settings as hqpweb last saw them, for the DAC in use (history.ts). */
  lastSeen: ReturnType<HistoryStore["lastSeen"]>;
  /**
   * Each mode's lists as last read on this engine, by name, with this instance's rate
   * limits applied: what another mode offers, for choosing before switching (Compare).
   */
  modeLists: Record<string, { filters: string[]; shapers: string[]; rates: Omit<RateOption, "index">[]; at: string }>;
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

/** What the check said, and how long HQPlayer was too busy to answer, if it was (watch.ts). */
export type PlaybackCheck = WatchResult | { kind: "not-checked"; detail: string; busyMs?: number };

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
