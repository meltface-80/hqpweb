// Which note a row in the list shows. The app's soft notes paraphrase HQPlayer's manual
// (compat.ts); the guide follows Signalyst's newer posts, and the two can disagree (the
// manual pairs NS9 with 176.4/192k, while a 2026 post offers it for ladder DACs at 384k).
// On a row the guide recommends for your answers, the guide's reason wins over the soft
// note. Warnings (won't play here, failed here before) are never dropped.
import type { Setup } from "../api.ts";

export interface ListRow {
  name: string;
  warn?: string;
  note?: string;
}

export function withGuideNotes<T extends ListRow>(rows: readonly T[], recommended: ReadonlySet<string>): T[] {
  return rows.map((r) => (recommended.has(r.name) && !r.warn && r.note ? { ...r, note: "Suits your answers: see Guide" } : r));
}

const AHM_5L = /^AHM[57]EC5L$/;
export const NOT_WITH_VOLUME = "Not with HQPlayer's volume (manual §4.5)";

/**
 * The manual (5.13 §4.5) doesn't recommend the five-level AHM versions when HQPlayer's
 * volume is the main control; it says nothing of the kind about 8B or 4B. So when the
 * listener says HQPlayer sets the volume, those rows say so. A warning still wins.
 */
export function withVolumeNotes<T extends ListRow>(rows: readonly T[], setup: Setup): T[] {
  if (setup.volume !== "hqplayer") return [...rows];
  return rows.map((r) => (AHM_5L.test(r.name) && !r.warn ? { ...r, note: NOT_WITH_VOLUME } : r));
}
