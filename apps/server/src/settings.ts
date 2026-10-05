// An instance's settings by name (design §4.3: never by index), from State and the
// current mode's lists.
import type { State } from "@app/protocol";
import type { Capabilities } from "./instance.ts";

/** Every setting this engine manages, by name. */
export interface Settings {
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
}

const nameOf = <T extends { index: number; name: string }>(list: T[], i: number) =>
  list.find((x) => x.index === i)?.name ?? `#${i}`;

export function settingsOf(caps: Capabilities, s: State): Settings {
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
    convolution: s.convolution,
    matrixProfile: s.matrixProfile,
  };
}
