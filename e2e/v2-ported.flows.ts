// The fake HQPlayers for v2-ported.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
// Set-ups first written for the classic layout's tests (retired), in the layout.
import { setRate, setShaper, type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // Playing on a machine that can't keep up with anything: a pick from the guide is rolled back.
  v2behind: { name: "V2 behind", profile: "desktop5-mac-sdm", speed: () => 0.6 },
  // PCM fixed at 192k, playing 44.1k: power-of-two filters (FFT) can't convert 4.35×.
  v2ratio: {
    name: "V2 ratio",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 192_000);
      f.playback = 2;
    },
  },
  // PCM fixed at 384k with TPDF, playing, no setup answers yet: the dither guide.
  v2dither: {
    name: "V2 dither",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 384_000);
      setShaper(f, "TPDF");
      f.playback = 2;
    },
  },
  // Stopped at DSD512 with AHM7EC8B (needs DSD1024): a queued track can't start, because of the modulator.
  v2wedgemod: {
    name: "V2 queued track, modulator",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 22_579_200);
      setShaper(f, "AHM7EC8B");
      f.playback = 0;
      f.feeder = "playlist";
    },
  },
};
