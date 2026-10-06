// "Find your DAC": which answers a DAC gives to the picker's two questions (how it
// takes DSD, how it converts PCM), with the evidence for each row. The models are in
// dac-models.ts. Checked 2026-10-05.
//
// Rules for these files (dacs.test.ts checks what it can):
// - A row goes in only when its chip or design and its DSD handling are confirmed
//   from a source we opened: the maker first, else a review or measurement. A row we
//   can't confirm is left out, never guessed.
// - Signalyst's advice (Jussi Laako's posts) is cited post by post, paraphrased, with
//   what it's about. Modulator advice keeps the principle (order, rate, 512+fs), never
//   an older-series modulator's name: newer modulators may suit better (isDated).
// - `ourReading` marks an answer that is our judgement, not Signalyst's or the maker's.
// - Corrections arrive as GitHub issues, from .github/ISSUE_TEMPLATE/dac-table.md
//   (link: …/issues/new?template=dac-table.md), with a link to the spec sheet.

/** How the DAC takes DSD: decides the modulator's order. */
export type DsdPath =
  /** ESS Sabre up to ES9038PRO, and ES9068: fifth-order modulators. */
  | "older-ess"
  /** Re-modulates DSD inside (ES9039 and later, the AK4191 pair, FPGA designs): seventh order. */
  | "remodulates"
  /** Passes DSD untouched to the converter (TI/Burr-Brown, ROHM, Holo, 1-bit paths, AKM in DSD Direct): seventh order. */
  | "direct"
  /** Converts DSD to PCM, or doesn't accept it: PCM output probably suits it better. */
  | "converts";

/** How the DAC converts PCM: decides whether noise shaping and lower DAC Bits help. */
export type PcmPath = "delta-sigma" | "ladder";

export interface Source {
  /** Absent when we only saw it in a search result and have no page to link yet. */
  url?: string;
  /** What it is, when there's no URL, e.g. "audiophonics.fr SU-9 and SU-9n pages". */
  label?: string;
  kind: "maker" | "review" | "retailer" | "signalyst";
  /** "search": seen only in a search result, not opened. Weaker; replace when possible. */
  seen: "opened" | "search";
}

/** A paraphrase of Signalyst's advice for this DAC, from one post. */
export interface Advice {
  text: string;
  url: string;
  /** "YYYY-MM" of the post. */
  date: string;
  /**
   * What it's about. Only modulator advice ages with new modulators (see isDated);
   * a fact about the hardware, or dither and DAC Bits advice, doesn't.
   */
  about: "modulator" | "dither" | "hardware";
}

/** A modulator release that may have made earlier advice dated (Signalyst's release notes). */
export interface Cutover {
  /** "YYYY-MM" of the release. */
  since: string;
  /** The mark shown on dated advice. */
  label: string;
  /** Its tooltip. */
  title: string;
  /** Which modulator advice it can date. */
  covers: (a: Advice) => boolean;
}

/**
 * Oldest first. 5.11.0 (2025-02-03) reworked EC-ul, -light and -super and added EC-fast:
 * any modulator advice before it may predate a better choice, as Signalyst said of older
 * posts. 6.1.0 (2026-09-22) added AHMxEC4B for DSD1024 and up: AHM / DSD1024 advice
 * before it may too.
 */
export const CUTOVERS: Cutover[] = [
  {
    since: "2025-02",
    label: "before 5.11's modulators",
    title: "Before HQPlayer 5.11 (Feb 2025) reworked the modulators: newer ones may suit better.",
    covers: () => true,
  },
  {
    since: "2026-09",
    label: "before 6.1's AHM 4B",
    title: "Before HQPlayer 6.1 (Sep 2026) added AHM 4B for DSD1024 and up: it may suit better.",
    covers: (a) => /AHM|DSD1024/.test(a.text),
  },
];

/** The release a piece of modulator advice predates (the oldest that applies), or null. */
export function datedBy(a: Advice): Cutover | null {
  if (a.about !== "modulator") return null;
  return CUTOVERS.find((c) => c.covers(a) && a.date < c.since) ?? null;
}

/** Modulator advice from before a newer modulator release: show it, marked as possibly dated. */
export const isDated = (a: Advice): boolean => datedBy(a) !== null;

export interface ChipFamily {
  id: string;
  chips: string;
  dsd: DsdPath;
  pcm: PcmPath;
  note?: string;
  advice?: Advice[];
}

export interface DacModel {
  id: string;
  maker: string;
  /** Model names this row covers, as printed on the unit. */
  models: string[];
  /** Same-named models this row must not match (a different design). */
  notThese?: string[];
  chip: string;
  dsd: DsdPath;
  /** Absent for a DAC with no PCM input. */
  pcm?: PcmPath;
  /** Highest native DSD rate, when known, e.g. "DSD512 (USB)". */
  dsdMax?: string;
  note?: string;
  /** The dsd/pcm answer is our reading, not Signalyst's or the maker's. */
  ourReading?: true;
  advice?: Advice[];
  sources: Source[];
}

export const jussi = (topicPost: string, date: string, about: Advice["about"], text: string): Advice => ({
  text,
  url: `https://community.roonlabs.com/t/${topicPost}`,
  date,
  about,
});
export const src = (url: string, kind: Source["kind"], seen: Source["seen"] = "opened"): Source => ({ url, kind, seen });
/** A source seen only in search results, with no page we can link yet: a gap to fill. */
export const unlinked = (label: string, kind: Source["kind"]): Source => ({ label, kind, seen: "search" });

export const CHECKED = "2026-10-05";

export const CHIP_FAMILIES: ChipFamily[] = [
  {
    id: "ess-older",
    chips: "ESS ES9018, ES9028, ES9038 (Pro, Q2M), ES9068",
    dsd: "older-ess",
    pcm: "delta-sigma",
    advice: [
      jussi(
        "261032/1422",
        "2026-09",
        "modulator",
        "Up to the ES9038PRO, fifth order; from the ES9039 on, seventh. A guide, not absolute.",
      ),
      jussi(
        "261032/848",
        "2025-03",
        "modulator",
        "The ES9068 is the older generation, so fifth order, though seventh is also fine.",
      ),
    ],
  },
  {
    id: "ess-9039",
    chips: "ESS ES9039 (Pro, SPro, MSPro, Q2M) and newer",
    dsd: "remodulates",
    pcm: "delta-sigma",
    advice: [jussi("261032/1422", "2026-09", "modulator", "From the ES9039 on, seventh order.")],
  },
  {
    id: "akm",
    chips: "AKM AK4490, AK4493, AK4497, AK4499",
    dsd: "direct",
    pcm: "delta-sigma",
    note: "Direct only where the maker enabled DSD Direct mode; otherwise the chip re-modulates DSD.",
    advice: [jussi("160210/676", "2022-02", "modulator", "AKM converts with several elements, so seventh order suits it.")],
  },
  {
    id: "akm-split",
    chips: "AKM AK4191 + AK4499EX",
    dsd: "remodulates",
    pcm: "delta-sigma",
    note: "Direct DSD only at DSD128 or DSD256, and only where the maker implemented it correctly; otherwise the AK4191 re-modulates DSD.",
    advice: [
      jussi("244358/725", "2024-02", "hardware", "These DACs take direct DSD only at DSD128 or DSD256."),
      jussi("321542/67", "2026-06", "hardware", "Gustard A26, with current firmware, passes direct DSD correctly (measured)."),
    ],
  },
  {
    id: "burr-brown",
    chips: 'Burr-Brown (TI) PCM179x, iFi "True Native"',
    dsd: "direct",
    pcm: "delta-sigma",
    note: "When the DAC accepts DSD, it reaches the chip untouched. Some PCM179x DACs are PCM-only.",
    advice: [
      jussi("160210/676", "2022-02", "modulator", "Burr-Brown converts with several elements, so seventh order suits it."),
    ],
  },
  {
    id: "ladder-dsd",
    chips: "Resistor ladder with its own DSD path",
    dsd: "direct",
    pcm: "ladder",
    note: "Holo, Musician, Gustard R26, Topping Centaurus. Not Denafrips: measured filtering DSD (see its rows).",
  },
  {
    id: "ladder-pcm",
    chips: "Resistor ladder, PCM only",
    dsd: "converts",
    pcm: "ladder",
    note: "Schiit multibit, Sonnet Morpheus.",
  },
  {
    id: "resamplers",
    chips: "Designs that resample everything",
    dsd: "converts",
    pcm: "delta-sigma",
    note: "Chord, Weiss, Mola Mola.",
    advice: [
      jussi("239948/18", "2023-04", "hardware", "Chord DACs convert DSD to 705.6 or 768 kHz PCM, so sending DSD doesn't help."),
    ],
  },
];
