// Validating changes to an instance's setup answers (config.ts, InstanceSetup).
import { HttpError } from "./errors.ts";
import type { InstanceSetup } from "./config.ts";

const ALLOWED: { [K in keyof Required<InstanceSetup>]: readonly NonNullable<InstanceSetup[K]>[] } = {
  dsd: ["older-ess", "remodulates", "direct", "converts"],
  pcm: ["delta-sigma", "ladder"],
  link: ["usb", "spdif"],
  volume: ["hqplayer", "elsewhere"],
};

/** A change to the answers: a value sets one, null clears it, a missing key leaves it alone. */
export type SetupChange = { [K in keyof InstanceSetup]?: InstanceSetup[K] | null };

export function parseSetupChange(body: unknown): SetupChange {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be an object");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const allowed = (ALLOWED as Record<string, readonly string[]>)[k];
    if (!allowed) throw new HttpError(400, `unknown setup question "${k}"`);
    if (v !== null && !allowed.includes(v as string))
      throw new HttpError(400, `${k} must be one of ${allowed.join(", ")}, or null`);
    out[k] = v;
  }
  return out as SetupChange;
}

/** The answers after a change. Returns undefined when nothing is answered. */
export function applySetupChange(current: InstanceSetup | undefined, change: SetupChange): InstanceSetup | undefined {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(change)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length ? (next as InstanceSetup) : undefined;
}
