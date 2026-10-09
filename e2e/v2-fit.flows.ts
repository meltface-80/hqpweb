// The fake HQPlayers for v2-fit.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { setRate, setShaper, type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // Playing a 44.1k track at a fixed DSD256 with ASDM7EC-super, on a machine that can't keep
  // up with sinc-L or sinc-Lh at DSD256 and above (half real time), but can at DSD128.
  v2fit: {
    name: "V2 fit",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 11_289_600);
      setShaper(f, "ASDM7EC-super");
      f.playback = 2;
    },
    speed: ({ filterName, rateHz }) => (/^sinc-Lh?$/.test(filterName) && rateHz >= 11_289_600 ? 0.5 : 1),
  },
};
