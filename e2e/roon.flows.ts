// The fake HQPlayers for roon.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  roon: { name: "Roon flow", profile: "desktop5-linux-pcm" },
};
