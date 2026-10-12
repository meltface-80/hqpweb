// How a fake HQPlayer is set up: timing, which settings stop playback, simulated load.
import { stopsByTable, type Combination } from "./stops.ts";
export { slotFor } from "./stops.ts";

export interface FakeOptions {
  /** Multiplies every measured delay. 1 = realistic, 0 = instant (tests). */
  timeScale?: number;
  /** Close a connection after this much idle time. Measured ≈156 s. */
  idleTimeoutMs?: number;
  /**
   * Whether the settings in use stop playback. Default: defaultIncompatible.
   */
  incompatible?: (c: Combination) => boolean;
  /**
   * Simulated CPU/GPU load: playback speed (1 = real time) for the settings in
   * use. Default: never overloaded. Measured (design §2.3: ASDM7EC at 0.53×): an
   * overloaded instance keeps state 2 while its position falls behind real time.
   */
  speed?: (c: { modeName: string; rateHz: number; filterName: string; shaperName: string }) => number;
  /** Matrix profiles configured in HQPlayer. Measured on both instances: none. */
  matrixProfiles?: string[];
  /**
   * The profiles whose matrix runs DAC correction ("" for the base config, no profile chosen):
   * Status `correction` reports 1 under them. Measured 2026-10-11 on Desktop 5.35.10: the base config
   * and a correction profile reported 1, a profile without it 0. Default: none.
   */
  correctingProfiles?: string[];
  /** Whether convolution impulse responses are configured. Measured: not, on both. */
  convolutionConfigured?: boolean;
  /** The clock playback position advances by, in ms. Default Date.now; tests pass one they advance. */
  now?: () => number;
  log?: (line: string) => void;
  /**
   * Whether SetMode during playback kills HQPlayer. Measured 2026-10-08 (Desktop 5.35.10,
   * macOS, Roon source, SDM DSD256 → PCM): a segfault, twice, same crash site; paused, the
   * switch works (~4.7 s). Unmeasured elsewhere (the Linux Desktop has one output mode;
   * Embedded untested), so the fake assumes the worst. Default true.
   */
  modeSwitchWhilePlayingCrashes?: boolean;
  /**
   * Whether SetMode while paused kills HQPlayer too. Measured 2026-10-09 (Embedded 6.2.5, macOS):
   * paused (state 1), then SetMode DSD→PCM: a segfault, 1 of 2 tries, plus one real crash with
   * Roon paused; stopped first, 0 of 3 (and SetMode answered in 0.1 s, not ~2.5 s). Desktop 5
   * survived paused switches on 10-08. The fake assumes the worst. Default true.
   */
  modeSwitchWhilePausedCrashes?: boolean;
  /**
   * After acknowledging SetFilter, how long HQPlayer answers nothing while it builds the
   * filter now in use, in ms; playback doesn't advance meanwhile. Measured 2026-10-09
   * (Desktop 5.35.10, macOS, DSD256, ASDM7EC-fast, 44.1k): sinc-L, 9.4 s, both times;
   * poly-sinc-ext2, none. Default: never busy (the older measurement, a slow SetFilter
   * reply, is DELAY.filterPrepare).
   */
  busyAfterFilter?: (filterName: string) => number;
  /**
   * Milliseconds HQPlayer answers nothing after a SetMode. Measured 2026-10-09 (Desktop
   * 5.35.10 and Embedded 6.2.5, macOS, own playlist): Status went unanswered ~2 s around a
   * switch; with Roon, up to ~7 s. Default: 0 (the switch's own reply delay is DELAY.mode).
   */
  busyAfterModeSwitch?: number;
  /**
   * Whether HQPlayer could fetch a URL added to its playlist. Measured 2026-10-09 (Embedded
   * 6.2.5): one it can't fetch, or that isn't served as it wants, gets OK and isn't kept.
   * Default: every URL can be fetched.
   */
  fetchable?: (uri: string) => boolean;
}

/**
 * Default: the fake's own table of what stops playback (stops.ts), each rule with its
 * evidence. Not the app's predictions, so tests of those can't agree with themselves.
 */
export const defaultIncompatible: NonNullable<FakeOptions["incompatible"]> = stopsByTable;
