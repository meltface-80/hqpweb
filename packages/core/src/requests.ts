// What a request asks for, checked before anything acts on it: strict, no unknown fields, no
// type coercion ("-20" is not a volume). In core, so the server and an app refuse the same
// things (the server's HTTP layer passes bodies through unchecked; service.ts checks them).
import { HttpError } from "./errors.ts";
import { TRANSPORT_ACTIONS, type Change, type TransportAction } from "./instance-types.ts";
import type { Combo } from "./learned.ts";

const FIELDS: Record<keyof Change, "name" | "profile" | "number" | "rate" | "boolean"> = {
  mode: "name",
  rate: "rate",
  filterNx: "name",
  filter1x: "name",
  shaper: "name",
  volume: "number",
  invert: "boolean",
  filter20k: "boolean",
  adaptive: "boolean",
  convolution: "boolean",
  // "" is no profile: HQPlayer's base matrix settings (measured: MatrixSetProfile "" returns to them).
  matrixProfile: "profile",
};

/** A change, by name. */
export function parseChange(body: unknown): Change {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const entries = Object.entries(body);
  if (entries.length === 0) throw new HttpError(400, "empty change");
  for (const [k, v] of entries) {
    const kind = FIELDS[k as keyof Change];
    if (!kind) throw new HttpError(400, `unknown field "${k}"`);
    const ok =
      kind === "name"
        ? typeof v === "string" && v.length > 0
        : kind === "profile"
          ? typeof v === "string"
          : kind === "number"
            ? typeof v === "number" && Number.isFinite(v)
            : kind === "rate"
              ? Number.isInteger(v) && (v as number) >= 0
              : typeof v === "boolean";
    const want = {
      name: "a non-empty string",
      profile: 'a profile name, or "" for none',
      number: "a number",
      rate: "a whole number of Hz (0 = auto)",
      boolean: "a boolean",
    }[kind];
    if (!ok) throw new HttpError(400, `"${k}" must be ${want}`);
  }
  return body as Change;
}

export function parsePresetBody(
  body: unknown,
  patch = false,
): { name?: string; settings?: Change; fromInstance?: string; includeVolume?: boolean; scope?: string | null } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const { name, settings, fromInstance, includeVolume, scope, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new HttpError(400, `unknown field "${Object.keys(rest)[0]}"`);
  if (name !== undefined && typeof name !== "string") throw new HttpError(400, "name must be a string");
  if (!patch && name === undefined) throw new HttpError(400, "name is required");
  if (fromInstance !== undefined && typeof fromInstance !== "string")
    throw new HttpError(400, "fromInstance must be an instance id");
  if (includeVolume !== undefined && typeof includeVolume !== "boolean")
    throw new HttpError(400, "includeVolume must be a boolean");
  // A DAC's scope (dac-scope.ts): "id" or "id#dac"; null (on a patch) shares it with all DACs.
  if (
    scope !== undefined &&
    !(scope === null && patch) &&
    !(typeof scope === "string" && /^[a-z0-9-]+(#[a-z0-9-]+)?$/.test(scope))
  )
    throw new HttpError(400, "scope must be an instance id, or id#dac");
  return {
    ...(name !== undefined ? { name: name as string } : {}),
    ...(settings !== undefined ? { settings: parseChange(settings) } : {}),
    ...(fromInstance !== undefined ? { fromInstance: fromInstance as string } : {}),
    ...(includeVolume !== undefined ? { includeVolume: includeVolume as boolean } : {}),
    ...(scope !== undefined ? { scope: scope as string | null } : {}),
  };
}

/** One combination, by name, to forget ("Forget this" beside a failure). Exactly these fields. */
export function parseCombo(body: unknown): Combo {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const { mode, rateHz, filter1x, filterNx, shaper, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new HttpError(400, `unknown field: ${Object.keys(rest).join(", ")}`);
  for (const [k, v] of Object.entries({ mode, filter1x, filterNx, shaper }))
    if (typeof v !== "string" || v.length > 200) throw new HttpError(400, `${k} must be a name`);
  if (typeof rateHz !== "number" || !Number.isFinite(rateHz) || rateHz < 0)
    throw new HttpError(400, "rateHz must be a rate in Hz");
  return { mode, rateHz, filter1x, filterNx, shaper } as Combo;
}

export function parseNewInstance(body: unknown): { name: string; host: string; port?: number } {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "body must be a JSON object");
  const { name, host, port, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new HttpError(400, `unknown field "${Object.keys(rest)[0]}"`);
  if (typeof name !== "string" || typeof host !== "string") throw new HttpError(400, "name and host are required strings");
  if (port !== undefined && !Number.isInteger(port)) throw new HttpError(400, "port must be a whole number");
  return { name, host, ...(port !== undefined ? { port: port as number } : {}) };
}

/** One of HQPlayer's transport actions. */
export function parseTransport(body: unknown): TransportAction {
  const b = body as { action?: unknown } | null;
  if (typeof b !== "object" || b === null || !TRANSPORT_ACTIONS.includes(b.action as TransportAction))
    throw new HttpError(400, `action must be one of ${TRANSPORT_ACTIONS.join(", ")}`);
  return b.action as TransportAction;
}

/** A position, in seconds from the start. */
export function parseSeek(body: unknown): number {
  const b = body as { seconds?: unknown } | null;
  if (typeof b !== "object" || b === null || typeof b.seconds !== "number" || !Number.isFinite(b.seconds) || b.seconds < 0)
    throw new HttpError(400, "seconds must be a number ≥ 0");
  return b.seconds;
}

/** A new name for an instance. */
export function parseRename(body: unknown): string {
  const b = body as { name?: unknown } | null;
  if (typeof b !== "object" || b === null || typeof b.name !== "string" || Object.keys(b).length !== 1)
    throw new HttpError(400, "body must be { name }");
  return b.name;
}

/** The volume cap after HQPlayer restarts (dB), or null for none. */
export function parseRestartCap(body: unknown): number | null {
  const b = body as { maxDb?: unknown } | null;
  if (typeof b !== "object" || b === null || Object.keys(b).length !== 1 || !("maxDb" in b))
    throw new HttpError(400, "body must be { maxDb: number | null }");
  if (b.maxDb !== null && typeof b.maxDb !== "number") throw new HttpError(400, "maxDb must be a number or null");
  return b.maxDb;
}

/** The DAC to use, by id. */
export function parseDacChoice(body: unknown): string {
  const b = body as { dac?: unknown } | null;
  if (typeof b?.dac !== "string") throw new HttpError(400, "body must be { dac }");
  return b.dac;
}
