// "Find your DAC" as shown: filtering the model rows, grouping them by maker, the labels
// for the answer cells, and each row's note. The table itself is dacs.ts and dac-models.ts.
import { datedBy, type Advice, type ChipFamily, type DacModel, type DsdPath, type PcmPath } from "./dacs.ts";

/** How a cell is shaded: the UI maps each to theme colours. */
export type Tone = "warn" | "accent" | "ok" | "dim" | "plain";
export interface CellLabel {
  label: string;
  tone: Tone;
}

const DSD_LABELS: Record<DsdPath, CellLabel> = {
  "older-ess": { label: "Older ESS", tone: "warn" },
  remodulates: { label: "Re-processes", tone: "accent" },
  direct: { label: "Direct", tone: "ok" },
  converts: { label: "Converts / none", tone: "dim" },
};
const PCM_LABELS: Record<PcmPath, CellLabel> = {
  ladder: { label: "Ladder", tone: "accent" },
  "delta-sigma": { label: "Delta-sigma", tone: "plain" },
};

export const dsdLabel = (d: DsdPath): CellLabel => DSD_LABELS[d];
/** `undefined`: a DAC with no PCM input. */
export const pcmLabel = (p: PcmPath | undefined): CellLabel => (p ? PCM_LABELS[p] : { label: "No PCM input", tone: "dim" });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** "2025-08" → "Aug 2025". */
export function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-");
  const name = MONTHS[Number(m) - 1];
  return name && y ? `${name} ${y}` : yyyyMm;
}

/** "2026-10-05" → "5 Oct 2026". */
export function dayLabel(yyyyMmDd: string): string {
  const day = Number(yyyyMmDd.slice(8, 10));
  return day ? `${day} ${monthLabel(yyyyMmDd.slice(0, 7))}` : yyyyMmDd;
}

/**
 * Model rows whose maker, model names or chip contain every word of the query, any case.
 * An empty query matches every row.
 */
export function filterModels(models: readonly DacModel[], query: string): DacModel[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    const text = [m.maker, ...m.models, m.chip].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export interface MakerGroup {
  maker: string;
  models: DacModel[];
}

/** Rows grouped by maker, makers in the order they first appear. No empty groups. */
export function groupByMaker(models: readonly DacModel[]): MakerGroup[] {
  const groups = new Map<string, DacModel[]>();
  for (const m of models) {
    const list = groups.get(m.maker);
    if (list) list.push(m);
    else groups.set(m.maker, [m]);
  }
  return [...groups].map(([maker, list]) => ({ maker, models: list }));
}

export interface NoteAdvice {
  text: string;
  url: string;
  /** "Jussi, Aug 2025". */
  cite: string;
  /** The newer modulator release this advice predates, if any (dacs.ts, CUTOVERS). */
  dated: { label: string; title: string } | null;
}

/** A row's note: plain text before and after Signalyst's advice, which the UI links. */
export interface RowNote {
  lead: string;
  advice: NoteAdvice[];
  tail: string;
}

export const OUR_READING = "The answers here are our reading, not Signalyst's.";

const dated = (a: Advice): NoteAdvice["dated"] => {
  const c = datedBy(a);
  return c ? { label: c.label, title: c.title } : null;
};

const noteAdvice = (a: Advice): NoteAdvice => ({
  text: a.text,
  url: a.url,
  cite: `Jussi, ${monthLabel(a.date)}`,
  dated: dated(a),
});

/** The note under a row: its note, native DSD rate, advice, our-reading flag and the models it isn't. */
export function rowNote(row: DacModel | ChipFamily): RowNote {
  const m: Partial<DacModel> = row;
  const lead = [row.note, m.dsdMax && `Native DSD up to ${m.dsdMax}.`].filter(Boolean).join(" ");
  const tail = [m.ourReading && OUR_READING, m.notThese?.length && `Not the ${m.notThese.join(", ")}.`].filter(Boolean).join(" ");
  return { lead, advice: (row.advice ?? []).map(noteAdvice), tail };
}

/** Whether a note has anything to show. */
export const hasNote = (n: RowNote): boolean => Boolean(n.lead || n.tail || n.advice.length);
