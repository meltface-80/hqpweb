// hqpweb's documents (core docs.ts) in the app's own storage on the device: files under
// hqpweb/ in its private data directory (named before the app became hqpmob; renaming it would lose
// what's there). Each phone keeps its own: no sync (owner's call).
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { DocStore } from "@app/core";

const directory = Directory.Data;
const path = (name: string) => `hqpweb/${name}`;

export class DeviceDocs implements DocStore {
  async read(name: string): Promise<string | null> {
    // List the folder rather than ask for a file that may not exist: that's an error each time.
    const listed = await Filesystem.readdir({ path: "hqpweb", directory }).catch(() => ({ files: [] }));
    if (!listed.files.some((f) => f.name === name)) return null; // none yet
    const r = await Filesystem.readFile({ path: path(name), directory, encoding: Encoding.UTF8 });
    return typeof r.data === "string" ? r.data : await r.data.text();
  }

  /** A temporary file, then renamed over the old one (Capacitor's rename replaces it). */
  async write(name: string, text: string): Promise<void> {
    const tmp = path(`${name}.tmp`);
    await Filesystem.writeFile({ path: tmp, directory, data: text, encoding: Encoding.UTF8, recursive: true });
    await Filesystem.rename({ from: tmp, to: path(name), directory });
  }

  async setAside(name: string): Promise<string> {
    const aside = `${name}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await Filesystem.rename({ from: path(name), to: path(aside), directory });
    return aside;
  }
}
