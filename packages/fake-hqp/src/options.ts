// How a fake HQPlayer is set up: timing, which settings stop playback, simulated load.
import { predictedStop } from "@app/protocol";

export interface FakeOptions {
  /** Multiplies every measured delay. 1 = realistic, 0 = instant (tests). */
  timeScale?: number;
  /** Close a connection after this much idle time. Measured ≈156 s. */
  idleTimeoutMs?: number;
  /**
   * Whether the settings in use stop playback. Default: defaultIncompatible.
   */
  incompatible?: (c: { modeName: string; rateHz: number; shaperName: string; filterName: string; sourceRate: number }) => boolean;
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
  log?: (line: string) => void;
}

/**
 * Default: what the manual's rules predict (integer-ratio filters, the AHM
 * modulator floor; see @app/protocol compat.ts). The AHM floor is also measured.
 */
export const defaultIncompatible: NonNullable<FakeOptions["incompatible"]> = (c) =>
  predictedStop({
    mode: c.modeName,
    filter: c.filterName,
    shaper: c.shaperName,
    sourceRate: c.sourceRate,
    outputRate: c.rateHz,
  }) !== undefined;
