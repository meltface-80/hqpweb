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
  /** Whether convolution impulse responses are configured. Measured: not, on both. */
  convolutionConfigured?: boolean;
  /** The clock playback position advances by, in ms. Default Date.now; tests pass one they advance. */
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * Default: the fake's own table of what stops playback (stops.ts), each rule with its
 * evidence. Not the app's predictions, so tests of those can't agree with themselves.
 */
export const defaultIncompatible: NonNullable<FakeOptions["incompatible"]> = stopsByTable;
