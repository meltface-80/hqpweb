// Stored preferences from older builds, read into today's shape (pure; prefs.svelte.ts uses it).

/**
 * Settings that no longer exist: the classic layout's ("layout", its filter list order, the
 * modulator sheet's List/Guide tab), retired after 0.1.0-beta.6. Dropped on load, so they aren't
 * saved back.
 */
export const RETIRED = ["layout", "filterOrder", "adviceTab"] as const;

export function withoutRetired(stored: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(stored).filter(([k]) => !(RETIRED as readonly string[]).includes(k)));
}
