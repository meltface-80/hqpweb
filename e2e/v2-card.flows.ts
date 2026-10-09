// The fake HQPlayers for v2-card.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // The v2 layout preview (docs/design-v2-layout.md).
  v2: { name: "V2", profile: "desktop5-mac-sdm" },
  v2auto: { name: "V2 auto", profile: "desktop5-mac-sdm" },
  v2mini: { name: "V2 mini", profile: "desktop5-mac-sdm" },
};
