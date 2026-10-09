// The fake HQPlayers for v2-pickers.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { setFilter, type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  v2filters: { name: "V2 filters", profile: "desktop5-mac-sdm" },
  v2shaper: { name: "V2 modulators", profile: "desktop5-mac-sdm" },
  v2apod: {
    name: "V2 apodization",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setFilter(f, "filter1x", "poly-sinc-hb");
      f.apod = 25;
    },
  },
};
