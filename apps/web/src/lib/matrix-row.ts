// The signal card's Matrix profile row (owner's design, 2026-10-11): always shown, as it's part
// of the signal chain. Its choices, what it reads, and where HQPlayer sets profiles up.

export interface MatrixChoice {
  index: number;
  name: string;
  /** What HQPlayer is sent: a profile's name, or "" for none (HQPlayer's base matrix settings). */
  value: string;
}

/**
 * The profiles to pick from, led by the no-profile choice: "Default", or "No profile" where a
 * profile is itself named Default (on Embedded 6.2.5 one was, with different settings: measured).
 * None set up: no choices, and the row says so.
 */
export function matrixChoices(profiles: string[], active: string): { choices: MatrixChoice[]; current: string } {
  if (profiles.length === 0) return { choices: [], current: "No profiles created" };
  const none = profiles.includes("Default") ? "No profile" : "Default";
  const choices = [{ index: -1, name: none, value: "" }, ...profiles.map((name, index) => ({ index, name, value: name }))];
  return { choices, current: active === "" ? none : active };
}

/**
 * Where this HQPlayer's profiles are set up, from its product name (GetInfo). The menu names
 * are the owner's recollection (Desktop 5: Matrix / Pipeline; Embedded's web page: Pipeline),
 * not yet checked on screen.
 */
export function whereToSetUp(product: string | undefined): string {
  if (/embedded/i.test(product ?? "")) return "in HQPlayer Embedded's web page (port 8088), under Pipeline";
  if (/desktop/i.test(product ?? "")) return "in HQPlayer Desktop, under its Matrix / Pipeline menu";
  return "in HQPlayer itself: Desktop's Matrix / Pipeline menu, or Embedded's web page under Pipeline";
}

/** The same, in a few words: the help after it's been collapsed once. */
export function whereShort(product: string | undefined): string {
  if (/embedded/i.test(product ?? "")) return "Set up in Embedded's Pipeline page.";
  if (/desktop/i.test(product ?? "")) return "Set up in Desktop's Matrix / Pipeline menu.";
  return "Set up in HQPlayer's Matrix / Pipeline settings.";
}
