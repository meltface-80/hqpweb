// Loading app-written JSON files (presets, learned failures). A missing file is
// normal. An unreadable one is moved aside, never silently overwritten by the
// next save.
import { existsSync, readFileSync, renameSync } from "node:fs";
import { checkFormat } from "./format.ts";

export function loadList<T>(path: string, key: string): T[] {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    checkFormat(path, data);
    const list = data[key];
    if (!Array.isArray(list)) throw new Error(`no "${key}" array`);
    return list as T[];
  } catch (e) {
    const aside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      renameSync(path, aside);
    } catch {}
    console.error(`could not read ${path} (${(e as Error).message}); moved it to ${aside} and started empty`);
    return [];
  }
}

/**
 * A list added to a file after it first shipped: absent in older files, which is
 * normal (empty), not a sign of corruption. Call after loadList has read the file.
 */
export function loadOptionalList<T>(path: string, key: string): T[] {
  if (!existsSync(path)) return [];
  try {
    const list = (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)[key];
    return Array.isArray(list) ? (list as T[]) : [];
  } catch {
    return [];
  }
}
