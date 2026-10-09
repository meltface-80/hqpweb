// The fake HQPlayers for settings-sheet.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import type { Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // Any instance will do: the sheet's own layout.
  settingssheet: { name: "Settings sheet", profile: "desktop5-mac-sdm" },
};
