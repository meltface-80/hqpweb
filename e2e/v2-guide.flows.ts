// The fake HQPlayers for v2-guide.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { setRate, setShaper, type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  v2guide: { name: "V2 guide", profile: "desktop5-mac-sdm" }, // SDM fixed at DSD512 with an old modulator, no setup answers yet: the guide's flow.
  v2pairs: {
    name: "V2 pairs",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 22_579_200);
      setShaper(f, "DSD7");
    },
  },
  // No setup answers yet: a DAC that converts DSD to PCM.
  v2converts: { name: "V2 converts", profile: "desktop5-mac-sdm" }, // Playing on a machine that can't keep up with anything: the falling-behind alarm.
  v2behindalarm: { name: "V2 behind alarm", profile: "desktop5-mac-sdm", speed: () => 0.6 },
};
