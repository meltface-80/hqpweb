// What hqpweb's API speaks: the JSON it sends and takes, and the calls it offers. Types
// only, erased at build: the web app imports these without pulling in any code, and the
// core is checked against them (packages/core test/contract.test.ts), so a field renamed
// on one side fails the build instead of the page. Moved from apps/web/src/lib/api.ts.

export type Inst = {
  id: string;
  name: string;
  host: string;
  port: number;
  source: "configured" | "discovered";
  discovered: boolean;
  reachable: boolean | null;
  error?: string;
  product?: string;
  engine?: string;
  /** The listener's setup answers for the DAC in use (server: config.ts). Absent: none answered. */
  setup?: Setup;
  /** Named DACs behind this HQPlayer (server: dac-scope.ts): main first; one unnamed = no picker. */
  dacs: { id: string; name: string }[];
  /** The DAC in use. */
  dac: string;
  /** After HQPlayer restarts, hqpweb lowers its volume to at most this (dB); absent: off. */
  restartVolumeCap?: number;
};
/** What the modulator and dither advice needs to know, and HQPlayer can't tell us. */
export type Setup = {
  dsd?: "older-ess" | "remodulates" | "direct" | "converts";
  pcm?: "delta-sigma" | "ladder";
  amp?: "class-d-or-tube" | "other" | "unsure";
  link?: "usb" | "spdif" | "i2s";
  volume?: "hqplayer" | "fixed";
};
/** description: HQPlayer 6 only (filters: "5/5 timbre ⥮ Any"; modulators: "Gen8"). */
export type Named = { index: number; name: string; description?: string };
export type State = {
  mode: number;
  /** The mode's value: -1 [source], 0 PCM, 1 SDM (HQPlayer's numbering). */
  activeMode: number;
  rate: number;
  filter1x: number;
  filterNx: number;
  filterInUse: number;
  shaper: number;
  volume: number;
  invert: boolean;
  filter20k: boolean;
  adaptive: boolean;
  convolution: boolean;
  matrixProfile: string;
  state: number;
};
export type Status = {
  state: number;
  activeMode: string;
  activeRate: number;
  activeFilter: string;
  activeShaper: string;
  /** Bits per sample of the output stream (32 in PCM, 1 in SDM): not the DAC Bits setting. */
  activeBits: number;
  volume: number;
  position: number;
  length: number;
  source: { sampleRate: number; bits: number; channels: number; song: string } | null;
  /** HQPlayer's output buffering in ms (server: parse.ts); null when not reported. */
  outputDelayMs?: number | null;
  /** HQPlayer's apodization and clip counters (0 when not reported). */
  apod?: number;
  clips?: number;
  /** DAC correction is running (it lives in the matrix profile in use); false when not reported. */
  correction?: boolean;
};
export type Snapshot = {
  status: Status;
  state: State;
  /** speed: position fit over 30 s; processSpeed: HQPlayer's own figure (×real time, 3 s average) when reported. */
  health?: { latencyMs: number; speed: number | null; processSpeed?: number | null };
  /** While stopped: the rate of the track HQPlayer's playlist would play next (null if none known). */
  queuedRate?: number | null;
  /** The volume rose sharply without hqpweb, e.g. HQPlayer restarted at its saved level. */
  volumeJump?: { from: number; to: number; at: string; restarted: boolean };
};
export type Failure = {
  mode: string;
  rateHz: number;
  filterNx: string;
  filter1x: string;
  shaper: string;
  reason: string;
  at: string;
  /** How many times it has failed here (the server keeps a history); absent: once. */
  count?: number;
  first?: string;
  /** Source sample rates it failed with; absent in older records. */
  sourceRates?: number[];
  /** HQPlayer's DAC correction was running (Status `correction`); absent: not known, applies either way. */
  correction?: boolean;
};
/** A combination that kept up here once settled (server: kept-up.ts), per source rate. */
export type KeptUp = Omit<Failure, "reason" | "count" | "sourceRates"> & {
  sourceRate: number;
  /** Lowest settled 5-second average, times faster than real time. */
  low: number;
  typical: number;
  sessions: number;
  first: string;
};
/** A filter HQPlayer was slow to switch to here (server: learned.ts SlowSwitch). */
export type SlowSwitch = {
  mode: string;
  rateHz: number;
  filter: string;
  sourceRate: number;
  /** How long HQPlayer answered nothing while switching, the latest time. */
  busyMs: number;
  at: string;
  count: number;
  /** HQPlayer's DAC correction was running; absent: not known, applies either way. */
  correction?: boolean;
};
/** One entry of an instance's change history (server: history.ts), newest first from the API. */
export type HistoryEntry = {
  at: string;
  instance: string;
  source: "hqpweb" | "preset" | "undo" | "elsewhere";
  changes: { field: string; from: unknown; to: unknown; applied?: boolean }[];
  playback?: string;
  detail?: string;
  rolledBack?: boolean;
};
/** One meter update (server meter-stream.ts). */
export type MeterEvent = {
  live: boolean;
  connected: boolean;
  levels?: number[][];
  bands?: number[][];
  edgesHz?: number[];
  /** Left/right correlation per band, −1 (out of phase) .. 1 (mono). */
  corr?: number[];
};
export type Mode = { index: number; name: string; value: number };
export type Capabilities = {
  engine: string;
  mode: Mode;
  modes: Mode[];
  filters: Named[];
  shapers: Named[];
  rates: { index: number; rate: number; allowed: boolean; note?: string }[];
  rateSettable: boolean;
  matrixProfiles: string[];
  /** HQPlayer's DAC correction is running: knownBad, keptUp and slowSwitches are what applies in that state. */
  correction: boolean;
  volumeRange: { min: number; max: number; enabled: boolean };
  knownBad: Failure[];
  keptUp: KeptUp[];
  slowSwitches: SlowSwitch[];
  /** Each mode's settings as hqpweb last saw them, for the DAC in use (server: history.ts). */
  lastSeen: Record<string, { rate: number; filterNx: string; filter1x: string; shaper: string; at: string }>;
  /** Each mode's lists as last read on this engine, by name (server: history.ts); for choosing before switching. */
  modeLists: Record<
    string,
    { filters: string[]; shapers: string[]; rates: { rate: number; allowed: boolean; note?: string }[]; at: string }
  >;
};
export type Change = Partial<{
  mode: string;
  rate: number;
  filterNx: string;
  filter1x: string;
  shaper: string;
  volume: number;
  invert: boolean;
  filter20k: boolean;
  adaptive: boolean;
  convolution: boolean;
  matrixProfile: string;
}>;
export type FieldResult = {
  field: keyof Change;
  requested: string | number | boolean;
  actual: string | number | boolean;
  applied: boolean;
  note?: string;
};
export type PlaybackCheck = {
  kind: "playing" | "stopped" | "struggling" | "inconclusive" | "not-checked";
  detail?: string;
  /** How long HQPlayer answered nothing after the change (a filter slow to build); absent when it always answered. */
  busyMs?: number;
};
export type RoonZone = {
  id: string;
  name: string;
  state: string;
  hqplayer: boolean;
  nowPlaying: { track: string; artist: string; album: string; imageKey?: string; seek?: number; length?: number } | null;
  allowed: { play: boolean; pause: boolean; next: boolean; previous: boolean; seek: boolean };
};
export type RoonStatus = "off" | "connecting" | "unapproved" | "connected" | "unreachable";
export type RoonView = {
  enabled: boolean;
  host?: string;
  port?: number;
  status: RoonStatus;
  error?: string;
  core?: { name: string; version: string };
  extensionName: string;
  zones: RoonZone[];
  zoneFor: Record<string, string>;
};
export type FoundCore = { host: string; port: number; name?: string; version?: string };
export type Preset = {
  id: string;
  name: string;
  settings: Change;
  createdAt: string;
  updatedAt: string;
  /** Kept for one DAC only (its scope, lib/dac-scope.ts); absent: shared by all. */
  scope?: string;
};
export type PresetView = Preset & {
  preview: {
    kind: "active" | "quick" | "major";
    differs: (keyof Change)[];
    missing: { field: keyof Change; reason: string }[];
    unchecked: boolean;
    predicted?: { level: "hard" | "soft"; text: string };
  };
};
export type ApplyResult = {
  class: "quick" | "major";
  results: FieldResult[];
  playback: PlaybackCheck;
  rolledBack: { results: FieldResult[]; playback: PlaybackCheck } | null;
  incompatible?: { level: "hard" | "soft"; text: string };
  skipped?: { field: keyof Change; reason: string }[];
  state: State;
  undoAvailable: boolean;
};

/** Fields that make up a combination that can fail. */
export type Combo = Pick<Failure, "mode" | "rateHz" | "filterNx" | "filter1x" | "shaper" | "correction">;

// ---- the API itself ------------------------------------------------------------------

/** One of HQPlayer's transport actions. */
export type TransportAction = "play" | "pause" | "stop" | "previous" | "next";
/** One of Roon's, for the instance's zone. */
export type RoonAction = "play" | "pause" | "playpause" | "previous" | "next";

/** What the live status stream says (server: the instance's poller). */
export interface StatusHandlers {
  /** A fresh snapshot, with its health. */
  now(snapshot: Snapshot): void;
  /** HQPlayer didn't answer: why. */
  unreachable(error: string): void;
  /** Roon's zone for this instance, when the host has Roon switched on. */
  roon?(view: { status: RoonStatus; zone: RoonZone | null }): void;
  /** The stream itself was lost (the server went away); it may come back by itself. */
  lost?(): void;
}

/** What the core serves (packages/core service.ts), wherever it runs: the server or the app. */
export interface CoreApi {
  instances(): Promise<Inst[]>;
  discover(): Promise<Inst[]>;
  addInstance(body: { name: string; host: string; port?: number }): Promise<{ id: string }>;
  renameInstance(id: string, name: string): Promise<{ id: string; name: string }>;
  removeInstance(id: string): Promise<{ ok: true }>;
  /** The instance as saved, with its cap (absent: off). */
  setRestartCap(
    id: string,
    maxDb: number | null,
  ): Promise<{ id: string; name: string; host: string; port: number; restartVolumeCap?: number }>;
  /** Set (a value) or clear (null) setup answers. A discovered instance is saved first: `savedNow`. */
  saveSetup(
    id: string,
    change: { [K in keyof Setup]?: Setup[K] | null },
  ): Promise<{ instance: { id: string; setup?: Setup }; savedNow: boolean }>;
  addDac(id: string, name: string, currentName?: string): Promise<{ dac: { id: string; name: string } }>;
  renameDac(id: string, dac: string, name: string): Promise<{ ok: true }>;
  removeDac(id: string, dac: string): Promise<{ ok: true }>;
  selectDac(id: string, dac: string): Promise<{ ok: true }>;
  capabilities(id: string): Promise<Capabilities>;
  change(id: string, change: Change): Promise<ApplyResult>;
  undo(id: string): Promise<ApplyResult>;
  transport(
    id: string,
    action: TransportAction,
  ): Promise<{ reply: unknown; status: Status; notStarted?: { explained?: string } }>;
  seek(id: string, seconds: number): Promise<{ status: Status }>;
  dismissVolumeJump(id: string): Promise<{ ok: boolean }>;
  presets(id: string): Promise<PresetView[]>;
  savePreset(
    body: { name: string; scope?: string } & ({ fromInstance: string; includeVolume: boolean } | { settings: Change }),
  ): Promise<Preset>;
  renamePreset(presetId: string, name: string): Promise<Preset>;
  updatePresetFromCurrent(presetId: string, fromInstance: string): Promise<Preset>;
  deletePreset(presetId: string): Promise<{ ok: true }>;
  applyPreset(id: string, presetId: string): Promise<ApplyResult>;
  learned(id: string): Promise<(Failure & { engine: string })[]>;
  history(id: string): Promise<HistoryEntry[]>;
  forgetLearned(id: string): Promise<{ forgotten: number }>;
  /** Forget one combination's failures and slow runs here ("Forget this"). */
  forgetCombo(id: string, combo: Combo): Promise<{ forgotten: number }>;
  /** Live status. Returns how to stop. */
  status(id: string, on: StatusHandlers): () => void;
  /** HQPlayer's meter, paced and condensed. Returns how to stop. */
  meter(id: string, on: (e: MeterEvent) => void): () => void;
}

/** What the host adds: its own version, the clap track it serves, and Roon (the server's, for now). */
export interface HostApi {
  health(): Promise<{ ok: boolean; version: string; commit?: string }>;
  /** Stop what's playing and play the clap track through HQPlayer (server calibrate-play.ts). */
  calibrate(id: string): Promise<{ playingAt: number; clapsMs: number[]; trackMs: number; outputDelayMs: number | null }>;
  roon(): Promise<RoonView>;
  configureRoon(body: { enabled?: boolean; host?: string; port?: number }): Promise<RoonView>;
  discoverRoon(): Promise<FoundCore[]>;
  setRoonZone(id: string, zone: string | null): Promise<RoonView>;
  roonSeek(id: string, seconds: number): Promise<RoonZone>;
  roonTransport(id: string, action: RoonAction): Promise<RoonZone>;
  /** Where the page loads a track's album art from: the server's route, or the core itself (the app). */
  roonArtUrl(key: string, size: number): string;
}

export type Api = CoreApi & HostApi;

/**
 * What the page's host can do, besides the core: the self-hosted server can do it all; a
 * phone app, less. The page asks this, never which platform it's on.
 */
export interface HostCan {
  /** Lower the volume after HQPlayer restarts: needs something always running, watching. */
  restartCap: boolean;
  /** Line the meter up by ear: the clap track, played through HQPlayer. */
  calibrate: boolean;
  /** Roon, linked by the host. */
  roon: boolean;
  /** Find HQPlayers on the network (multicast discovery). */
  discover: boolean;
}

/** Where the page runs: the API it talks to, and what that host can do. */
export interface Host {
  api: Api;
  can: HostCan;
  /** What the page calls itself: "hqpweb" on the server, "hqpmob" in the phone app. */
  name: string;
}
