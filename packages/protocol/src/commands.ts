// Request builders. Shapes are the ones sent live on 2026-10-02 (design §2.3).
// Setters take LIST INDICES, which depend on mode and engine version: resolve
// by name immediately before use, never cache across a mode change.
import { element } from "./xml.ts";

const index = (i: number) => {
  if (!Number.isInteger(i) || i < 0) throw new Error(`list index must be a non-negative integer, got ${i}`);
  return i;
};

export const cmd = {
  getInfo: () => element("GetInfo"),
  state: () => element("State"),
  status: () => element("Status", { subscribe: 0 }),
  getModes: () => element("GetModes"),
  getFilters: () => element("GetFilters"),
  getShapers: () => element("GetShapers"),
  getRates: () => element("GetRates"),
  volumeRange: () => element("VolumeRange"),
  configurationList: () => element("ConfigurationList"),
  // Matrix profiles: syntax from the MIT SDK source (hqp-control 6.0.1). Reported
  // (HQPTuner): an unknown name still gets OK and State echoes it, so only ever
  // send names from matrixListProfiles.
  matrixListProfiles: () => element("MatrixListProfiles"),
  matrixGetProfile: () => element("MatrixGetProfile"),
  matrixSetProfile: (name: string) => element("MatrixSetProfile", { value: name }),

  // Transport (SDK source). With Roon driving, these act on HQPlayer underneath Roon.
  play: () => element("Play", { last: 0 }),
  pause: () => element("Pause"),
  /** Seconds into the current track (SDK: `Seek position`). Works on local files, not on unseekable streams (measured). */
  seek: (seconds: number) => element("Seek", { position: Math.max(0, Math.round(seconds)) }),
  stop: () => element("Stop"),
  previous: () => element("Previous"),
  next: () => element("Next"),

  setMode: (i: number) => element("SetMode", { value: index(i) }),
  setRate: (i: number) => element("SetRate", { value: index(i) }),
  /** Always send both; the live harness did (unverified what omitting value1x does). */
  setFilter: (nx: number, x1: number) => element("SetFilter", { value: index(nx), value1x: index(x1) }),
  setShaping: (i: number) => element("SetShaping", { value: index(i) }),
  setInvert: (on: boolean) => element("SetInvert", { value: on }),
  set20kFilter: (on: boolean) => element("Set20kFilter", { value: on }),
  setAdaptiveVolume: (on: boolean) => element("SetAdaptiveVolume", { value: on }),
  setConvolution: (on: boolean) => element("SetConvolution", { value: on }),
  /**
   * Absolute volume in dB. This builder only checks it is finite; the "never
   * raise implicitly, clamp to VolumeRange.max" policy belongs to the caller.
   */
  volume: (db: number) => {
    if (!Number.isFinite(db)) throw new Error(`volume must be a finite dB value, got ${db}`);
    return element("Volume", { value: db });
  },
} as const;
