// The fake HQPlayers for v2-layout.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // Wide and narrow screens, with a meter stream.
  v2wide: { name: "V2 wide", profile: "desktop5-mac-sdm", meter: true },
};
