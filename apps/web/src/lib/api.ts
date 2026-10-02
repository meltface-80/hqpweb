// Thin client for the app's own HTTP API.

export type Inst = { id: string; name: string };
export type Named = { index: number; name: string };
export type State = {
  mode: number;
  rate: number;
  filter1x: number;
  filterNx: number;
  filterInUse: number;
  shaper: number;
  volume: number;
  invert: boolean;
  filter20k: boolean;
  adaptive: boolean;
  state: number;
};
export type Status = {
  state: number;
  activeMode: string;
  activeRate: number;
  activeFilter: string;
  activeShaper: string;
  volume: number;
  source: { sampleRate: number; bits: number; channels: number } | null;
};
export type Snapshot = { status: Status; state: State };
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
}>;
export type FieldResult = {
  field: keyof Change;
  requested: string | number | boolean;
  actual: string | number | boolean;
  applied: boolean;
  note?: string;
};
export type PlaybackCheck = { kind: "playing" | "stopped" | "struggling" | "inconclusive" | "not-checked"; detail?: string };
export type ApplyResult = {
  class: "quick" | "major";
  results: FieldResult[];
  playback: PlaybackCheck;
  rolledBack: { results: FieldResult[]; playback: PlaybackCheck } | null;
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
  instances: () => call<Inst[]>("/api/instances"),
  capabilities: (id: string) => call<Capabilities>(`/api/instances/${id}/capabilities`),
  change: (id: string, change: Change) =>
    call<ApplyResult>(`/api/instances/${id}/change`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    }),
  undo: (id: string) => call<ApplyResult>(`/api/instances/${id}/undo`, { method: "POST" }),
  events: (id: string) => new EventSource(`/api/instances/${id}/events`),
};

export const PLAYBACK = ["Stopped", "Paused", "Playing", "Stopping"];

/** "DSD256", "384 kHz", "1.536 MHz"; 0 is "Auto". */
export function formatRate(hz: number, modeName: string): string {
  if (!hz) return "Auto";
  if (modeName.startsWith("SDM") && hz % 44100 === 0) return `DSD${hz / 44100}`;
  if (hz >= 1_000_000) return `${hz / 1_000_000} MHz`;
  return `${hz / 1000} kHz`;
}

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
