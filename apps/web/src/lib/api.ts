// Thin client for the app's own HTTP API.

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
  volume: number;
  position: number;
  length: number;
  source: { sampleRate: number; bits: number; channels: number; song: string } | null;
  /** HQPlayer's apodization and clip counters (0 when not reported). */
  apod?: number;
  clips?: number;
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
};
export type Capabilities = {
  engine: string;
  mode: { index: number; name: string; value: number };
  modes: { index: number; name: string; value: number }[];
  filters: Named[];
  shapers: Named[];
  rates: { index: number; rate: number; allowed: boolean; note?: string }[];
  rateSettable: boolean;
  matrixProfiles: string[];
  volumeRange: { min: number; max: number; enabled: boolean };
  knownBad: Failure[];
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
export type PlaybackCheck = { kind: "playing" | "stopped" | "struggling" | "inconclusive" | "not-checked"; detail?: string };
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
export type Preset = { id: string; name: string; settings: Change; createdAt: string; updatedAt: string };
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
}

export const api = {
  health: () => call<{ ok: boolean; version: string; commit?: string }>("/api/health"),
  instances: () => call<Inst[]>("/api/instances"),
  addInstance: (body: { name: string; host: string; port?: number }) =>
    call<{ id: string }>("/api/instances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  renameInstance: (id: string, name: string) =>
    call<{ id: string; name: string }>(`/api/instances/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  removeInstance: (id: string) => call<{ ok: true }>(`/api/instances/${id}`, { method: "DELETE" }),
  discover: () => call<Inst[]>("/api/discover", { method: "POST" }),
  capabilities: (id: string) => call<Capabilities>(`/api/instances/${id}/capabilities`),
  change: (id: string, change: Change) =>
    call<ApplyResult>(`/api/instances/${id}/change`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    }),
  transport: (id: string, action: "play" | "pause" | "stop" | "previous" | "next") =>
    call<{ reply: unknown; status: Status; notStarted?: { explained?: string } }>(`/api/instances/${id}/transport`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }),
  undo: (id: string) => call<ApplyResult>(`/api/instances/${id}/undo`, { method: "POST" }),
  dismissVolumeJump: (id: string) => call<{ ok: boolean }>(`/api/instances/${id}/dismissjump`, { method: "POST" }),
  presets: (id: string) => call<PresetView[]>(`/api/instances/${id}/presets`),
  savePreset: (body: { name: string; fromInstance: string; includeVolume: boolean }) =>
    call<Preset>("/api/presets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  renamePreset: (pid: string, name: string) =>
    call<Preset>(`/api/presets/${pid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  updatePresetFromCurrent: (pid: string, fromInstance: string) =>
    call<Preset>(`/api/presets/${pid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromInstance }),
    }),
  deletePreset: (pid: string) => call<{ ok: true }>(`/api/presets/${pid}`, { method: "DELETE" }),
  applyPreset: (id: string, pid: string) => call<ApplyResult>(`/api/instances/${id}/presets/${pid}/apply`, { method: "POST" }),
  learned: (id: string) => call<(Failure & { engine: string })[]>(`/api/instances/${id}/learned`),
  forgetLearned: (id: string) => call<{ forgotten: number }>(`/api/instances/${id}/learned`, { method: "DELETE" }),
  events: (id: string) => new EventSource(`/api/instances/${id}/events`),
  roon: () => call<RoonView>("/api/roon"),
  configureRoon: (body: { enabled?: boolean; host?: string; port?: number }) =>
    call<RoonView>("/api/roon", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  discoverRoon: () => call<FoundCore[]>("/api/roon/discover", { method: "POST" }),
  setRoonZone: (id: string, zone: string | null) =>
    call<RoonView>(`/api/instances/${id}/roonzone`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zone }),
    }),
  seek: (id: string, seconds: number) =>
    call<{ status: Status }>(`/api/instances/${id}/seek`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seconds }),
    }),
  roonSeek: (id: string, seconds: number) =>
    call<RoonZone>(`/api/instances/${id}/roonseek`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seconds }),
    }),
  roonTransport: (id: string, action: "play" | "pause" | "playpause" | "previous" | "next") =>
    call<RoonZone>(`/api/instances/${id}/roontransport`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }),
};

export const PLAYBACK = ["Stopped", "Paused", "Playing", "Stopping"];

/** "DSD256", "384 kHz", "1.536 MHz"; 0 is "Auto". */
export function formatRate(hz: number, modeName: string): string {
  if (!hz) return "Auto";
  if (modeName.startsWith("SDM") && hz % 44100 === 0) return `DSD${hz / 44100}`;
  if (hz >= 1_000_000) return `${hz / 1_000_000} MHz`;
  return `${hz / 1000} kHz`;
}

/**
 * A field's name as the pickers show it. The shaper is a modulator in SDM and dither in PCM;
 * `sdm` undefined (mode unknown) names both.
 */
export const fieldLabel = (field: keyof Change, sdm?: boolean) =>
  field === "shaper" ? (sdm === undefined ? "Dither or modulator" : sdm ? "Modulator" : "Dither") : FIELD_LABEL[field];

export const FIELD_LABEL: Record<keyof Change, string> = {
  mode: "Mode",
  rate: "Output rate",
  filterNx: "Nx filter",
  filter1x: "1x filter",
  shaper: "Modulator",
  volume: "Volume",
  invert: "Invert",
  filter20k: "20 kHz filter",
  adaptive: "Adaptive volume",
  convolution: "Convolution",
  matrixProfile: "Matrix profile",
};

/** Fields that make up a combination that can fail. */
export type Combo = Pick<Failure, "mode" | "rateHz" | "filterNx" | "filter1x" | "shaper">;

export function knownBad(list: Failure[], combo: Combo): Failure | undefined {
  return list.find(
    (f) =>
      f.mode === combo.mode &&
      f.rateHz === combo.rateHz &&
      f.filterNx === combo.filterNx &&
      f.filter1x === combo.filter1x &&
      f.shaper === combo.shaper,
  );
}
