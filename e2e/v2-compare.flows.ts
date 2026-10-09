// The fake HQPlayers for v2-compare.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  v2compare: { name: "V2 compare", profile: "desktop5-mac-sdm" },
};
