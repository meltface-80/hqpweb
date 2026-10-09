// The fake HQPlayers for advice.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { setShaper, setRate, type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // SDM fixed at DSD512 with an old modulator, no setup answers yet: the guide's flow.
  guide: {
    name: "Guide",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 22_579_200);
      setShaper(f, "DSD7");
    },
  },
  // PCM fixed at 384k with TPDF, playing, no setup answers yet: the dither guide's flow.
  dither: {
    name: "Dither",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 384_000);
      setShaper(f, "TPDF");
      f.playback = 2;
    },
  },
  // Stopped at DSD512 with AHM7EC8B (needs DSD1024): a queued track can't start, because of the modulator.
  wedgemod: {
    name: "Queued track, modulator",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 22_579_200);
      setShaper(f, "AHM7EC8B");
      f.playback = 0;
      f.feeder = "playlist";
    },
  },
  // Playing at DSD1024 with AHM7EC8B: rate and modulator have to change together.
  pairnet: {
    name: "Pairs",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 45_158_400);
      setShaper(f, "AHM7EC8B");
    },
  },
  // A short screen: the sheet's body must scroll to its end.
  scroll: { name: "Scroll", profile: "desktop5-mac-sdm" },
  // Playing on a machine that can't keep up with anything: the falling-behind alarm.
  behind: { name: "Behind", profile: "desktop5-mac-sdm", speed: () => 0.6 },
  // HQPlayer stops answering (a test closes it): the restart steps.
  down: { name: "Down", profile: "desktop5-mac-sdm" },
};
