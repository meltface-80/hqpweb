// Who controls playback, what a change risks, and the volume step (moved from App.svelte;
// pure, tested in control.test.ts).
import type { Change, RoonZone, Snapshot } from "./api.ts";

export type TransportAction = "play" | "pause" | "stop" | "previous" | "next";

/**
 * HQPlayer-side transport with Roon as the source (measured 2026-10-02, design §2.2): a
 * Pause sent to HQPlayer pauses the Roon zone, but Play and Next don't reach Roon, so
 * after a pause only Roon can resume. So with a mapped Roon zone, controls go to Roon;
 * without one, only Stop is offered. Roon drives the card only while it's the source (or
 * HQPlayer is idle): when HQPlayer plays something else, its own controls apply.
 */
export function control(snap: Snapshot | null, zone: RoonZone | null) {
  const fromRoon = snap?.status.source?.song === "Roon";
  const viaRoon = zone && (fromRoon || snap?.status.state === 0) ? zone : null;
  return {
    fromRoon,
    viaRoon,
    /** Roon is the source and the Roon link isn't set up: offer only Stop. */
    stopOnly: fromRoon && !viaRoon,
    playing: viaRoon ? viaRoon.state === "playing" : snap?.status.state === 2,
    allowed: (a: Exclude<TransportAction, "stop">) => (viaRoon ? viaRoon.allowed[a] : !fromRoon),
    /** Where a command goes: Stop always to HQPlayer, the rest to Roon when it drives. */
    route: (a: TransportAction): "roon" | "hqplayer" => (viaRoon && a !== "stop" ? "roon" : "hqplayer"),
  };
}

/** Roon playing while this HQPlayer sits stopped: usually the wrong zone is mapped. */
export const zoneMismatch = (snap: Snapshot | null, zone: RoonZone | null) =>
  snap?.status.state === 0 && zone?.state === "playing";

/** Changes that can stop playback. Must match the server's RISKY (instance.ts); a test checks. */
export const RISKY: readonly (keyof Change)[] = [
  "mode",
  "rate",
  "filterNx",
  "filter1x",
  "shaper",
  "convolution",
  "matrixProfile",
];
export const isRisky = (change: Change) => (Object.keys(change) as (keyof Change)[]).some((k) => RISKY.includes(k));

/** The −/+ buttons: one step, clamped to HQPlayer's range; null when it wouldn't move. */
export function stepVolume(current: number, step: number, range: { min: number; max: number }): number | null {
  const v = Math.min(range.max, Math.max(range.min, current + step));
  return v === current ? null : v;
}
