// The signal-path card's words (docs/design-v2-layout.md): the path line, what "auto"
// picked and why, and the other mode's tab. Pure, so the rules are tested here and the
// component only shows them.
import { ratioClass } from "@app/protocol/compat";
import { formatRate, type Mode } from "./api.ts";
import type { SpeedClass } from "./speed.ts";

const k = (hz: number) => `${hz / 1000}k`;
/** The path line's short form: "gauss-xla" for "poly-sinc-gauss-xla". */
const shortFilter = (name: string) => name.replace(/^poly-sinc-/, "");

/** Source → filter → shaping → output → DAC; parts not known yet are left out. */
export function pathSteps(p: {
  source: number;
  filter: string;
  shaper: string;
  outRate: number;
  modeName: string;
  dac?: string;
}): string[] {
  // By the rate itself: right after a mode switch, the reading can still be the old mode's.
  const dsd = p.outRate >= 2_822_400 && p.outRate % 44_100 === 0;
  const out = p.outRate ? (dsd ? formatRate(p.outRate, "SDM (DSD)") : k(p.outRate)) : "";
  return [p.source ? k(p.source) : "", p.filter ? shortFilter(p.filter) : "", p.shaper, out, p.dac ?? ""].filter(Boolean);
}

export interface AutoNote {
  /** "Auto → 705.6 kHz" */
  text: string;
  why: string;
  /** Worth a warning: in DSD, the rate auto picked has failed here with this shaping. */
  warn: boolean;
  /** Fixed rates to offer instead, highest first (DSD only, when warning). */
  fixed?: number[];
}

const times = (n: number) => (n === 2 ? "twice" : n > 2 ? `${n} times` : "");

/**
 * What auto picked and why (measured 2026-10-08, Desktop 5.35.10): in PCM, the highest
 * rate the filter can use from this source (sinc-M from 44.1k → 705.6k; an any-ratio
 * filter → the highest offered); in DSD, always the highest rate offered, whatever the
 * source. Whole-number filters are inferred to follow the PCM rule.
 */
export function autoNote(p: {
  sdm: boolean;
  /** The rate setting is auto. */
  auto: boolean;
  /** What's in use now (0: nothing playing). */
  outRate: number;
  filter: string;
  source: number;
  shaper: string;
  rates: number[];
  /** How often this combination has failed here (learned failures). */
  failedHere?: number;
}): AutoNote | null {
  if (!p.auto) return null;
  if (!p.outRate) return { text: "Auto", why: "", warn: false };
  const rate = formatRate(p.outRate, p.sdm ? "SDM (DSD)" : "PCM");
  const text = `Auto → ${rate}`;
  if (p.sdm) {
    const why = "In DSD, auto is always the highest rate.";
    if (!p.failedHere) return { text, why, warn: false };
    const fixed = p.rates
      .filter((r) => r > 0 && r < p.outRate)
      .sort((a, b) => b - a)
      .slice(0, 2);
    const n = times(p.failedHere);
    return { text, why: `${why} ${p.shaper} fell behind here at ${rate}${n ? ` (${n})` : ""}.`, warn: true, fixed };
  }
  const cls = ratioClass(p.filter);
  const lead = "Auto picks the highest rate this filter can use for this track.";
  const why =
    cls === "pow2" || cls === "pow2-up"
      ? `${lead} ${p.filter} needs a power-of-two step from ${k(p.source)}, so ${rate} here.`
      : cls === "integer" || cls === "integer-up"
        ? `${lead} ${p.filter} needs a whole-number step from ${k(p.source)}, so ${rate} here.`
        : cls === "any" || cls === "any-up"
          ? `${lead} ${p.filter} takes any ratio, so the highest offered.`
          : lead;
  return { text, why, warn: false };
}

/** The tab for the mode not in use: DSD from PCM and back. "[source]" isn't a tab (for later). */
export function otherMode(modes: Mode[], current: string): { label: "DSD" | "PCM"; name: string | null; offered: boolean } {
  const toPcm = current.startsWith("SDM");
  const m = modes.find((x) => (toPcm ? x.name === "PCM" : x.name.startsWith("SDM")));
  return { label: toPcm ? "PCM" : "DSD", name: m?.name ?? null, offered: !!m };
}

/** "today 15:42" or "Tue 13:42": when the other mode's settings were last seen. */
export function seenWhen(at: string, now = new Date()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? `today ${time}`
    : `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`;
}

/** The path line's health word (docs/design-v2-layout.md rule 4): a dot plus a word, everywhere. */
export function healthWord(cls: SpeedClass, playing: boolean): string {
  if (!playing) return "not playing";
  return cls === "bad" ? "falling behind" : cls === "warn" ? "straining" : "keeping up";
}

/** DSD rates offered when DSD's last rate isn't known: 256 and 512 (×44.1k), never auto by default. */
export const DSD_CHOICES = [11_289_600, 22_579_200];

/**
 * What a mode switch will set the rate to. HQPlayer resets it to auto on a switch; the
 * server puts back the mode's last-seen fixed rate (instance.ts withModeRate). With none
 * known, PCM's auto is fine (it fits the filter), but DSD's auto is the highest rate, so
 * the sheet asks for one instead.
 */
export function switchPlan(target: "DSD" | "PCM", seenRate: number | undefined): { rate: number | null; ask: boolean } {
  if (seenRate) return { rate: seenRate, ask: false };
  return { rate: null, ask: target === "DSD" };
}

/**
 * A reported output rate, only if it belongs to the mode in use; else 0 (unknown). After
 * a mode switch while paused, HQPlayer keeps reporting the old mode's last rate until
 * playback starts (seen 2026-10-08: 768k shown for DSD).
 */
export function rateInMode(hz: number, modeName: string): number {
  const dsdRate = hz >= 2_822_400 && hz % 44_100 === 0;
  return modeName.startsWith("SDM") === dsdRate ? hz : 0;
}
