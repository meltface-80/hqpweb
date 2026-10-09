// The fake HQPlayers for dacs.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // Named DACs behind one HQPlayer: answers follow the DAC in use.
  dacs: { name: "DACs", profile: "desktop5-mac-sdm" },
};
