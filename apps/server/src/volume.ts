// The volume guard (design §7: volume is the one safety-critical path). Pure, so its
// rules can be checked exhaustively (test/volume.property.test.ts).

/** Largest single volume *raise* accepted, in dB. Lowering is never limited. */
export const MAX_RAISE_DB = 6;
/** Volume read-back tolerance, dB. */
export const VOLUME_EPS = 0.01;

export interface VolumeRequest {
  /** dB, as asked for. */
  requested: number;
  /** dB, as HQPlayer reports it now. */
  current: number;
  range: { min: number; max: number; enabled: boolean };
  /**
   * change: anything the user asks for (including a preset).
   * undo: the user pressed Undo. rollback: hqpweb is undoing a change that stopped playback.
   */
  kind: "change" | "undo" | "rollback";
  /** The volume is still what hqpweb's last change set: nobody has moved it since. */
  untouched: boolean;
}

export interface VolumeDecision {
  /** The volume to send, or undefined to leave it as it is. */
  set: number | undefined;
  /** Shown with the result. */
  note?: string;
  /** Why the request is refused: the whole change fails, unless it's lenient (a preset). */
  problem?: string;
}

export function decideVolume(r: VolumeRequest): VolumeDecision {
  if (!r.range.enabled) return { set: undefined, problem: "volume control is disabled on this instance" };
  // The API already rejects these; this is the last line before HQPlayer.
  if (!Number.isFinite(r.requested)) return { set: undefined, problem: "volume must be a finite number of dB" };
  const set = Math.max(r.range.min, Math.min(r.range.max, r.requested));
  const clamped = set !== r.requested ? `clamped to ${set} dB (range ${r.range.min}…${r.range.max})` : undefined;
  const raise = set - r.current;
  // Nobody asked for a rollback: it may lower the volume, never raise it (no implicit raise).
  if (r.kind === "rollback" && raise > VOLUME_EPS)
    return { set: undefined, note: `kept at ${r.current} dB: a rollback never raises the volume` };
  if (raise <= MAX_RAISE_DB + VOLUME_EPS) return { set, ...(clamped ? { note: clamped } : {}) };
  if (r.kind === "change")
    return {
      set: undefined,
      problem: `refusing to raise volume by ${raise.toFixed(1)} dB in one step (max ${MAX_RAISE_DB} dB)`,
      ...(clamped ? { note: clamped } : {}),
    };
  // Undo may return to the level the user was just listening at, but only if nobody
  // has moved the volume since hqpweb's change.
  if (r.untouched) return { set, ...(clamped ? { note: clamped } : {}) };
  return {
    set: undefined,
    note: `not restored: volume was changed elsewhere, and restoring would raise it by ${raise.toFixed(1)} dB`,
  };
}
