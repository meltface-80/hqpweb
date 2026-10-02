// App-owned presets (design §4.3): named bundles of settings, stored by NAME so
// they work across instances and modes. Global; resolved per instance at apply time.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError, type Change } from "./instance.ts";

export interface Preset {
  id: string;
  name: string;
  settings: Change;
  createdAt: string;
  updatedAt: string;
}

export class PresetStore {
  private presets: Preset[] = [];
  private readonly path: string | null;

  /** path null = in memory only (tests). */
  constructor(path: string | null) {
    this.path = path;
    if (!path) return;
    try {
      this.presets = (JSON.parse(readFileSync(path, "utf8")) as { presets: Preset[] }).presets ?? [];
    } catch {
      this.presets = [];
    }
  }

  list(): Preset[] {
    return this.presets;
  }

  get(id: string): Preset {
    const p = this.presets.find((x) => x.id === id);
    if (!p) throw new HttpError(404, "unknown preset");
    return p;
  }

  create(name: string, settings: Change): Preset {
    const now = new Date().toISOString();
    const p: Preset = { id: randomUUID().slice(0, 8), name: this.checkName(name), settings, createdAt: now, updatedAt: now };
    this.presets.push(p);
    this.save();
    return p;
  }

  update(id: string, patch: { name?: string; settings?: Change }): Preset {
    const p = this.get(id);
    if (patch.name !== undefined) p.name = this.checkName(patch.name, id);
    if (patch.settings !== undefined) p.settings = patch.settings;
    p.updatedAt = new Date().toISOString();
    this.save();
    return p;
  }

  remove(id: string) {
    this.get(id);
    this.presets = this.presets.filter((x) => x.id !== id);
    this.save();
  }

  private checkName(name: string, exceptId?: string): string {
    const n = name.trim();
    if (!n || n.length > 64) throw new HttpError(400, "name must be 1–64 characters");
    if (this.presets.some((x) => x.id !== exceptId && x.name.toLowerCase() === n.toLowerCase()))
      throw new HttpError(409, `a preset named "${n}" already exists`);
    return n;
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify({ presets: this.presets }, null, 1) + "\n");
    renameSync(`${this.path}.tmp`, this.path);
  }
}
