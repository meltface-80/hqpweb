// DACs behind one HQPlayer: an HQPlayer that plays to more than one DAC, switched in
// HQPlayer itself (a saved profile per DAC). HQPlayer's control protocol can't say which
// DAC is in use or switch to another, so the listener names them and picks the one in
// use; the setup answers, learned failures and that DAC's presets follow the choice.
//
// The model is MusicD-Remote's (Rouen 1.8.85, lib/hqp/players.js, by meltface-80, MIT),
// adopted as-is so data saved by either app keeps its meaning when the other ports this:
// "main" is always first; a DAC's id comes from its name; and everything for the main DAC
// stays under the HQPlayer's own id (`scopeOf`), so nothing saved before moves.
//
// `output` is reserved: if HQPlayer ever reports or switches its output device over the
// control API, the device it names goes here. Unused for now.
import { HttpError } from "./errors.ts";
import type { InstanceSetup } from "./config.ts";

export const MAIN = "main";
export const MAX_DACS = 8;
const RESERVED = ["demo", MAIN];
const ID = /^[a-z0-9-]{1,40}$/;

export interface DacEntry {
  id: string;
  /** "" for the main DAC until a second is added. */
  name: string;
  /** Reserved: HQPlayer's output device, if it ever reports one. */
  output?: string;
  /** This DAC's setup answers (not for main, whose answers stay on the instance). */
  setup?: InstanceSetup;
}

const bad = (m: string) => new HttpError(400, m);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "dac";

function checkName(name: unknown, what: string): string {
  const n = String(name ?? "").trim();
  if (!n || n.length > 64) throw bad(`${what} must be 1–64 characters`);
  return n;
}

/** A stored DAC list made safe: main always there and first; bad or repeated ids dropped. */
export function cleanDacs(raw: unknown): DacEntry[] {
  const out: DacEntry[] = [];
  const seen = new Set<string>();
  for (const d of Array.isArray(raw) ? raw : []) {
    if (!d || typeof d !== "object") continue;
    const { id, name, output, setup } = d as Partial<DacEntry>;
    if (typeof id !== "string" || !ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: typeof name === "string" ? name.trim().slice(0, 64) : "",
      ...(typeof output === "string" && output ? { output } : {}),
      ...(setup && typeof setup === "object" ? { setup } : {}),
    });
    if (out.length >= MAX_DACS) break;
  }
  if (!seen.has(MAIN)) out.unshift({ id: MAIN, name: "" });
  else out.sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : 0));
  return out.slice(0, MAX_DACS);
}

/** Adds a DAC. The first is named too (`currentName`, else "First DAC"): a picker needs both. */
export function addDac(dacs: DacEntry[], input: { name: unknown; currentName?: unknown }) {
  const list = dacs.map((d) => ({ ...d }));
  if (list.length >= MAX_DACS) throw bad(`that's the most DACs one HQPlayer can have here (${MAX_DACS})`);
  const name = checkName(input.name, "the DAC's name");
  const main = list[0]!;
  if (!main.name) main.name = checkName(input.currentName || "First DAC", "the first DAC's name");
  if (list.some((d) => d.name.toLowerCase() === name.toLowerCase()))
    throw new HttpError(409, `there's already a DAC called “${name}”`);
  let id = slug(name);
  if (RESERVED.includes(id)) id = `${id}-dac`;
  for (let n = 2; list.some((d) => d.id === id); n++) id = `${slug(name).slice(0, 36)}-${n}`;
  const dac = { id, name };
  list.push(dac);
  return { dacs: list, dac };
}

export function renameDac(dacs: DacEntry[], dacId: string, name: unknown): DacEntry[] {
  const list = dacs.map((d) => ({ ...d }));
  const d = list.find((x) => x.id === dacId);
  if (!d) throw new HttpError(404, "no such DAC");
  const n = checkName(name, "the DAC's name");
  if (list.some((x) => x !== d && x.name.toLowerCase() === n.toLowerCase()))
    throw new HttpError(409, `there's already a DAC called “${n}”`);
  d.name = n;
  return list;
}

/** The first DAC can be renamed but not removed: it holds what was there before any were named. */
export function removeDac(dacs: DacEntry[], active: string, dacId: string) {
  if (dacId === MAIN) throw bad("the first DAC can be renamed but not removed");
  const list = dacs.filter((d) => d.id !== dacId).map((d) => ({ ...d }));
  if (list.length === dacs.length) throw new HttpError(404, "no such DAC");
  // Down to one: it goes back to being just "the DAC", with no picker.
  if (list.length === 1) list[0]!.name = "";
  return { dacs: list, dac: active === dacId ? MAIN : active };
}

export function selectDac(dacs: DacEntry[], dacId: string): string {
  if (!dacs.some((d) => d.id === dacId)) throw new HttpError(404, "no such DAC");
  return dacId;
}

/** The DAC in use: the stored choice if it still exists, else the main DAC. */
export function activeDac(cfg: { dacs?: DacEntry[]; dac?: string }): string {
  return cfg.dac && cleanDacs(cfg.dacs).some((d) => d.id === cfg.dac) ? cfg.dac : MAIN;
}

/** The key a DAC's setup answers, learned failures and own presets are kept under. */
export const scopeOf = (instanceId: string, dacId: string | undefined) =>
  !dacId || dacId === MAIN ? instanceId : `${instanceId}#${dacId}`;
