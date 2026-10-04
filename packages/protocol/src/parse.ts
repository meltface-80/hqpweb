// Typed views over HQPlayer replies. Field names and meanings are measured on
// Desktop 5.32.5 (macOS) and 5.35.10 (Linux) unless marked otherwise.
import type { Element } from "./xml.ts";

/** Reply outcome. `none` is real: Set20kFilter and SetAdaptiveVolume reply with no `result` (measured). */
export type Outcome = { kind: "ok" } | { kind: "none" } | { kind: "error"; message: string };

export function outcome(el: Element): Outcome {
  const r = el.attrs.result;
  if (r === undefined) return { kind: "none" };
  if (r === "OK") return { kind: "ok" };
  return { kind: "error", message: el.text.trim() || r };
}

/** 0 stopped, 1 paused, 2 playing, 3 stop requested (design §2.1). */
export type PlaybackState = 0 | 1 | 2 | 3;

function num(el: Element, key: string): number {
  const raw = el.attrs[key];
  if (raw === undefined) throw new Error(`<${el.name}> has no ${key}`);
  // Number("") is 0: for volume that would read as 0 dB, full output.
  const n = raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) throw new Error(`<${el.name}> ${key}="${raw}" is not a number`);
  return n;
}

/**
 * Volume is a float in dB. macOS prints "-22", Linux "-28.00000000000000000"
 * (both measured). Never parse it as an integer: a client that did got 0 dB.
 */
export function volumeDb(el: Element, key = "volume"): number {
  return num(el, key);
}

function playback(el: Element): PlaybackState {
  const s = num(el, "state");
  if (s !== 0 && s !== 1 && s !== 2 && s !== 3) throw new Error(`unknown playback state ${s}`);
  return s;
}

const flag = (el: Element, key: string) => el.attrs[key] !== undefined && el.attrs[key] !== "0";

export interface Info {
  name: string;
  product: string;
  platform: string;
  /** Major version only (design §2.5). */
  version: string;
  /** The real engine version, e.g. "5.32.5". */
  engine: string;
}

export function parseInfo(el: Element): Info {
  const a = el.attrs;
  return {
    name: a.name ?? "",
    product: a.product ?? "",
    platform: a.platform ?? "",
    version: a.version ?? "",
    engine: a.engine ?? "",
  };
}

/** Configured settings, as list indices. */
export interface State {
  /** Index into GetModes. */
  mode: number;
  /** Mode *value* (-1 source, 0 PCM, 1 SDM), not an index. */
  activeMode: number;
  /** Index into GetRates; 0 is auto. */
  rate: number;
  activeRate: number;
  filter1x: number;
  filterNx: number;
  /** The filter currently in use. Not a setting. */
  filterInUse: number;
  shaper: number;
  volume: number;
  invert: boolean;
  filter20k: boolean;
  adaptive: boolean;
  convolution: boolean;
  matrixProfile: string;
  state: PlaybackState;
}

export function parseState(el: Element): State {
  return {
    mode: num(el, "mode"),
    activeMode: num(el, "active_mode"),
    rate: num(el, "rate"),
    activeRate: num(el, "active_rate"),
    filter1x: num(el, "filter1x"),
    filterNx: num(el, "filterNx"),
    filterInUse: num(el, "filter"),
    shaper: num(el, "shaper"),
    volume: volumeDb(el),
    invert: flag(el, "invert"),
    filter20k: flag(el, "filter_20k"),
    adaptive: flag(el, "adaptive"),
    convolution: flag(el, "convolution"),
    matrixProfile: el.attrs.matrix_profile ?? "",
    state: playback(el),
  };
}

function sourceOf(el: Element): Status["source"] {
  const m = el.children.find((c) => c.name === "metadata");
  if (!m || m.attrs.samplerate === undefined) return null;
  // song is "Roon" when Roon feeds HQPlayer its raw stream (measured on both instances).
  return {
    sampleRate: num(m, "samplerate"),
    bits: Number(m.attrs.bits ?? 0),
    channels: Number(m.attrs.channels ?? 0),
    song: m.attrs.song ?? "",
  };
}

/** Live values, by name. */
export interface Status {
  state: PlaybackState;
  activeMode: string;
  activeRate: number;
  activeFilter: string;
  activeShaper: string;
  volume: number;
  /** Seconds, float. */
  position: number;
  /** Track length in seconds; 0 when unknown, e.g. a Roon stream (measured). */
  length: number;
  /**
   * HQPlayer's processing speed as a multiple of real time (measured on 5.17.2
   * and 6.2.3: ~30 while playing light settings, 0 when stopped). Null on older
   * versions that don't report it (5.13 doesn't).
   */
  processSpeed: number | null;
  /**
   * HQPlayer's apodization counter: how often the recording needed what an
   * apodizing filter corrects. The v5 manual (§4.6) advises an apodizing filter
   * once it passes 10 in a track. Present on 5.17.2 and 6.2.3 (measured, 0 so far).
   */
  apod: number;
  /** HQPlayer's clip counter (inferred: overs it had to clip). 0 so far in every capture. */
  clips: number;
  track: number;
  tracksTotal: number;
  /** From the <metadata> child, present while playing (measured). Decides 1x vs Nx filter. */
  source: { sampleRate: number; bits: number; channels: number; song: string } | null;
}

/**
 * Sample rate of the track HQPlayer would play next from its own playlist: the
 * current entry (Status `track`, 1-based) or else the first. Measured on 6.2.3:
 * a track that can't start leaves Status with state 0, track 0 and no metadata,
 * while PlaylistGet still lists it with its rate. Null when the playlist is empty.
 */
export function queuedRate(el: Element, track: number): number | null {
  const items = el.children.filter((c) => c.name === "PlaylistItem");
  const it = items.find((c) => Number(c.attrs.index) === track) ?? items[0];
  const r = it ? Number(it.attrs.rate) : NaN;
  return Number.isFinite(r) && r > 0 ? r : null;
}

export function parseStatus(el: Element): Status {
  return {
    state: playback(el),
    activeMode: el.attrs.active_mode ?? "",
    activeRate: num(el, "active_rate"),
    activeFilter: el.attrs.active_filter ?? "",
    activeShaper: el.attrs.active_shaper ?? "",
    volume: volumeDb(el),
    position: Number(el.attrs.position ?? 0),
    length: Number(el.attrs.length ?? 0) || 0,
    processSpeed: el.attrs.process_speed === undefined ? null : Number(el.attrs.process_speed) || 0,
    apod: Number(el.attrs.apod ?? 0) || 0,
    clips: Number(el.attrs.clips ?? 0) || 0,
    track: Number(el.attrs.track ?? 0),
    tracksTotal: Number(el.attrs.tracks_total ?? 0),
    source: sourceOf(el),
  };
}

export interface Mode {
  index: number;
  name: string;
  value: number;
}
export interface Filter {
  index: number;
  name: string;
  value: number;
  /**
   * Opaque. NOT a reliable 1x/Nx flag: the Mac's active 1x and Nx filters both
   * have arg=1 (measured). Kept for later investigation against the SDK source.
   */
  arg: number;
  /** HQPlayer 6: a short description meant for control apps, e.g. "5/5 timbre ⥮ Any". */
  description?: string;
}
export interface Shaper {
  index: number;
  name: string;
  value: number;
  /** HQPlayer 6, SDM modulators: the design generation, e.g. "Gen8". */
  description?: string;
}
export interface Rate {
  index: number;
  /** Hz; 0 is auto. */
  rate: number;
}

const kids = (el: Element, tag: string) => el.children.filter((c) => c.name === tag);

export const parseModes = (el: Element): Mode[] =>
  kids(el, "ModesItem").map((c) => ({ index: num(c, "index"), name: c.attrs.name ?? "", value: num(c, "value") }));

export const parseFilters = (el: Element): Filter[] =>
  kids(el, "FiltersItem").map((c) => ({
    index: num(c, "index"),
    name: c.attrs.name ?? "",
    value: num(c, "value"),
    arg: Number(c.attrs.arg ?? 0),
    ...(c.attrs.description ? { description: c.attrs.description } : {}),
  }));

export const parseShapers = (el: Element): Shaper[] =>
  kids(el, "ShapersItem").map((c) => ({
    index: num(c, "index"),
    name: c.attrs.name ?? "",
    value: num(c, "value"),
    ...(c.attrs.description ? { description: c.attrs.description } : {}),
  }));

export const parseRates = (el: Element): Rate[] =>
  kids(el, "RatesItem").map((c) => ({ index: num(c, "index"), rate: num(c, "rate") }));

export interface VolumeRange {
  min: number;
  /** -3 on the Mac, 0 on Linux (both measured). Clamp to this; never assume. */
  max: number;
  enabled: boolean;
  adaptive: boolean;
}

export function parseVolumeRange(el: Element): VolumeRange {
  return {
    min: volumeDb(el, "min"),
    max: volumeDb(el, "max"),
    enabled: flag(el, "enabled"),
    adaptive: flag(el, "adaptive"),
  };
}

/** <MatrixListProfiles> children are <MatrixProfile name="…"/> (SDK source; empty list measured). */
export const parseMatrixProfiles = (el: Element): string[] =>
  kids(el, "MatrixProfile")
    .map((c) => c.attrs.name ?? "")
    .filter(Boolean);

/** Names only. Loading them is blocked by auth (design §2.4). */
export function parseConfigurationList(el: Element): { names: string[]; active: string } | { error: string } {
  const o = outcome(el);
  if (o.kind === "error") return { error: o.message };
  return { names: kids(el, "ConfigurationItem").map((c) => c.attrs.name ?? ""), active: el.attrs.active ?? "" };
}
