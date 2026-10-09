// Restart recovery (owner's request, 2026-10-09): HQPlayer comes back from a relaunch at
// its saved volume, not the one in use (office −15 every relaunch, Mac −23 once; measured
// 2026-10-08), while Roon resumes straight away, so a few seconds play louder than before.
// With a cap set for the instance, hqpweb lowers the volume to it after a restart. It only
// ever lowers, and only on a restart's signature: HQPlayer stopped answering, then came
// back with a different volume. A network blip that leaves the volume alone does nothing.

/** Volumes differing by less than this are the same (HQPlayer reports fractions). */
const SAME_DB = 0.5;

export class RestartGuard {
  /** The volume at the last good reading before HQPlayer stopped answering. */
  private before: number | null = null;
  private down = false;

  /** HQPlayer didn't answer. */
  failed() {
    this.down = true;
  }

  /**
   * HQPlayer answered with this volume. Returns the volume to lower to (the cap), or null
   * for nothing to do.
   */
  answered(volume: number, cap: number | undefined): number | null {
    const back = this.down;
    const was = this.before;
    this.down = false;
    this.before = volume;
    if (!back || was === null || cap === undefined) return null;
    if (Math.abs(volume - was) < SAME_DB) return null; // a blip, not a relaunch
    return volume > cap + SAME_DB / 10 ? cap : null;
  }
}
