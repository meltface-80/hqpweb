// Settings files (instances, presets, learned failures, Roon) carry a format number.
// Files written before it existed have none and count as format 1. When a file's
// shape changes, bump this and migrate on load; the golden tests in
// test/settings.test.ts load today's files to catch accidental breakage.

export const SETTINGS_FORMAT = 1;

/** Warn when a file comes from a newer hqpweb: this version may not keep all of it. */
export function checkFormat(path: string, data: unknown) {
  const f = (data as { format?: unknown } | null)?.format;
  if (typeof f === "number" && f > SETTINGS_FORMAT)
    console.warn(
      `${path} was written by a newer hqpweb (settings format ${f}; this version knows ${SETTINGS_FORMAT}). ` +
        "Settings it doesn't know about may be lost when it saves.",
    );
}
