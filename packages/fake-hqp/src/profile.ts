import { readFileSync } from "node:fs";

export interface ProfileFilter {
  index: number;
  name: string;
  value: number;
  arg: number;
}
export interface ProfileShaper {
  index: number;
  name: string;
  value: number;
}
export interface ModeLists {
  filters: ProfileFilter[];
  shapers: ProfileShaper[];
  /** Hz; index 0 is auto (rate 0). */
  rates: number[];
  provenance: string;
}
export interface Remembered {
  filterNx: number;
  filter1x: number;
  shaper: number;
}

/** A captured instance, sanitised. Built by tools/fixtures/build_profile.py. */
export interface Profile {
  id: string;
  info: { engine: string; name: string; platform: string; product: string; version: string };
  discover: { version: string };
  volumeFormat: "short" | "long";
  volumeRange: { min: number; max: number; enabled: number; adaptive: number };
  configurations: string[] | null;
  configurationListError: string | null;
  modes: { index: number; name: string; value: number }[];
  /** Keyed by mode value ("0" PCM, "1" SDM). */
  lists: Record<string, ModeLists>;
  initial: Record<string, string>;
  activeRateWhenAuto: Record<string, number>;
  /** Per mode value: the filter/dither HQPlayer remembers for that mode (measured behaviour, §2.3). */
  remembered: Record<string, Remembered>;
  provenance: { measured: string; inferred: string[] };
}

export const PROFILE_IDS = ["desktop5-mac-sdm", "desktop5-linux-pcm"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export function loadProfile(id: ProfileId | string): Profile {
  const url = new URL(`../profiles/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Profile;
}
