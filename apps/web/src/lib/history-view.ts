// How the History sheet words the server's change history (history.ts on the server):
// grouped by day, newest first, one line per change saying what and how it went.
import { fieldLabel, type Change, type HistoryEntry } from "./api.ts";

export type HistoryFilter = "all" | "kept" | "rolled-back" | "elsewhere";

export interface HistoryRow {
  key: string;
  what: string;
  time: string;
  how: string;
  /** ok: kept and playing; bad: rolled back or not taken. */
  tone: "ok" | "bad" | "";
}

const isDsdRate = (hz: number) => hz >= 2_822_400 && hz % 44_100 === 0;

function value(field: string, v: unknown, fmtRate: (hz: number, mode: string) => string): string {
  if (field === "rate" && typeof v === "number") return fmtRate(v, isDsdRate(v) ? "SDM (DSD)" : "PCM");
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v);
}

function how(e: HistoryEntry): { how: string; tone: HistoryRow["tone"] } {
  if (e.source === "elsewhere") return { how: "made outside hqpweb", tone: "" };
  if (e.changes.some((c) => c.applied === false)) return { how: "HQPlayer didn't take it", tone: "bad" };
  const prefix = e.source === "undo" ? "undo · " : e.source === "preset" ? "preset · " : "";
  if (e.rolledBack) return { how: `${prefix}${e.detail ?? "didn't play"} · rolled back`, tone: "bad" };
  return e.playback === "playing" ? { how: `${prefix}kept · playing`, tone: "ok" } : { how: `${prefix}kept`, tone: "" };
}

function dayOf(d: Date, now: Date): string {
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function historyRows(
  entries: HistoryEntry[],
  filter: HistoryFilter,
  fmtRate: (hz: number, mode: string) => string,
  now = new Date(),
): { day: string; rows: HistoryRow[] }[] {
  const keep = (e: HistoryEntry) =>
    filter === "all" ||
    (filter === "elsewhere" && e.source === "elsewhere") ||
    (filter === "rolled-back" && !!e.rolledBack) ||
    (filter === "kept" && e.source !== "elsewhere" && !e.rolledBack);
  const out: { day: string; rows: HistoryRow[] }[] = [];
  entries.filter(keep).forEach((e, i) => {
    const d = new Date(e.at);
    const day = dayOf(d, now);
    const what = e.changes
      .map(
        (c) =>
          `${c.field === "shaper" ? "Modulator or dither" : fieldLabel(c.field as keyof Change)} → ${value(c.field, c.to, fmtRate)}`,
      )
      .join("; ");
    const row = {
      key: `${e.at}-${i}`,
      what,
      time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      ...how(e),
    };
    const last = out[out.length - 1];
    if (last?.day === day) last.rows.push(row);
    else out.push({ day, rows: [row] });
  });
  return out;
}
