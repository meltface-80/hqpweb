// The fake HQPlayers for v2-guide-filters.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // Playing a 44.1k track: the 1x filter is the one in use.
  v2guidefilters: { name: "V2 guide to filters", profile: "desktop5-mac-sdm" },
};
