// What the footer says after a change (moved from App.svelte; pure, tested in result.test.ts).
import { FIELD_LABEL, type ApplyResult, type Change, type PlaybackCheck } from "./api.ts";

export interface ResultMessage {
  kind: "ok" | "warn" | "error" | "info";
  text: string;
  /** Offer "Restart playback" (Stop, then Play): a rollback left HQPlayer's own playlist stopped. */
  restart?: boolean;
}

/** Formats a value for display, e.g. a rate in Hz as "176.4 kHz". */
export type Show = (field: keyof Change, v: string | number | boolean) => string;

/** `fromRoon`: Roon was the source when the change was made. */
export function describe(r: ApplyResult, show: Show, fromRoon: boolean): ResultMessage {
  const base = describeCore(r, show, fromRoon);
  if (!r.skipped?.length) return base;
  const sk = r.skipped.map((x) => `${FIELD_LABEL[x.field]} (${x.reason})`).join("; ");
  return { ...base, kind: "warn", text: `${base.text} · Skipped: ${sk}` };
}

function describeCore(r: ApplyResult, show: Show, fromRoon: boolean): ResultMessage {
  if (r.rolledBack) {
    const back = r.rolledBack.results.map((x) => `${FIELD_LABEL[x.field]} back to ${show(x.field, x.actual)}`).join(", ");
    const rec: PlaybackCheck = r.rolledBack.playback;
    // Measured (5.35.10): from HQPlayer's own playlist it doesn't resume by itself, and
    // nothing resumes it reliably, so the user chooses; Roon resumes by itself (design §2.3).
    const stopped = rec.kind !== "playing" && rec.kind !== "not-checked";
    const tail =
      rec.kind === "playing"
        ? "Playback resumed."
        : !stopped
          ? ""
          : fromRoon
            ? `Playback stopped (${rec.detail}): resume it in Roon.`
            : `Playback stopped (${rec.detail}): restart it below. If it still won't play, restart HQPlayer.`;
    return {
      kind: "warn",
      text: r.incompatible
        ? `Rolled back: ${r.incompatible.text}. ${back}. ${tail} That's an HQPlayer rule, not a limit of this machine.`
        : `Rolled back: ${r.playback.detail}. ${back}. ${tail} Marked as not working on this instance.`,
      ...(stopped && !fromRoon ? { restart: true } : {}),
    };
  }
  const failed = r.results.filter((x) => !x.applied);
  const notes = r.results.filter((x) => x.note).map((x) => `${FIELD_LABEL[x.field]} ${x.note}`);
  if (failed.length) {
    const text = failed
      .map((x) => `${FIELD_LABEL[x.field]}: asked for ${show(x.field, x.requested)}, HQPlayer reports ${show(x.field, x.actual)}`)
      .concat(notes)
      .join(" · ");
    return { kind: "warn", text };
  }
  if (r.results.length === 0) return { kind: "warn", text: "Nothing applied" };
  const text = r.results.map((x) => `${FIELD_LABEL[x.field]} → ${show(x.field, x.actual)}`);
  const pb =
    r.playback.kind === "playing"
      ? "playback OK"
      : r.playback.kind === "not-checked" && r.playback.detail?.startsWith("nothing")
        ? "not playing, so not checked"
        : r.playback.kind === "inconclusive"
          ? `playback not checked (${r.playback.detail})`
          : "";
  return { kind: "ok", text: ["✓ " + text.join(", "), pb, ...notes].filter(Boolean).join(" · ") };
}
