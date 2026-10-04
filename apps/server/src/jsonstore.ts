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
