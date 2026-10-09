// The fake HQPlayers for v2-meter.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  v2meter: { name: "V2 meter", profile: "desktop5-mac-sdm", meter: true },
  // No meter stream: the strip says so.
  v2nometer: { name: "V2 no meter", profile: "desktop5-mac-sdm" },
};
