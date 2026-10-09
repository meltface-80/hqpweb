// The fake HQPlayers for v2-guide.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  v2guide: { name: "V2 guide", profile: "desktop5-mac-sdm" },
};
