// Golden settings files: what an install made by 0.1 (before settings carried a
// format number) has in its config volume, with invented contents. Every release
// must load these without losing anything, and keep them on the next save.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChange } from "../src/app.ts";
import { loadConfig, saveConfig } from "../src/config.ts";
import { SETTINGS_FORMAT } from "../src/format.ts";
import { LearnedStore } from "../src/learned.ts";
import { PresetStore } from "../src/presets.ts";
import { RoonLink } from "../src/roon/roon.ts";

const FIXTURES = join(import.meta.dirname, "fixtures/settings-0.1");
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "hqpweb-settings-"));
  cpSync(FIXTURES, dir, { recursive: true });
  return dir;
};
const json = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));

const links: RoonLink[] = [];
afterEach(() => {
  for (const l of links.splice(0)) l.close();
  vi.restoreAllMocks();
});

describe("settings from 0.1 (no format number) load and survive a save", () => {
  it("instances", () => {
    const dir = fresh();
    const cfg = loadConfig(dir);
    expect(cfg.instances).toEqual(json(dir, "instances.json").instances);
    expect(cfg.instances[1]).toMatchObject({ id: "office", limits: { maxPcmRate: 384000 } });
    saveConfig(dir, cfg);
    expect(json(dir, "instances.json")).toEqual({ format: SETTINGS_FORMAT, instances: cfg.instances });
    expect(loadConfig(dir)).toMatchObject({ instances: cfg.instances });
  });

  it("presets", () => {
    const dir = fresh();
    const before = json(dir, "presets.json").presets;
    const store = new PresetStore(join(dir, "presets.json"), parseChange);
    expect(store.list()).toEqual(before);
    store.create("New one", { volume: -40 });
    const saved = json(dir, "presets.json");
    expect(saved.format).toBe(SETTINGS_FORMAT);
    expect(saved.presets.slice(0, 2)).toEqual(before);
    expect(new PresetStore(join(dir, "presets.json"), parseChange).list()).toHaveLength(3);
  });

  it("learned failures", () => {
    const dir = fresh();
    const before = json(dir, "learned.json").failures;
    const store = new LearnedStore(join(dir, "learned.json"));
    expect(store.all("office")).toEqual(before);
    store.record({ ...before[0], shaper: "ASDM7EC-light", at: "2026-10-05T00:00:00.000Z" });
    const saved = json(dir, "learned.json");
    expect(saved.format).toBe(SETTINGS_FORMAT);
    expect(saved.failures).toHaveLength(2);
    expect(saved.failures[0]).toEqual(before[0]);
  });

  it("Roon: install id, core, approval tokens and zone mapping", () => {
    const dir = fresh();
    const before = json(dir, "roon.json");
    const link = new RoonLink(join(dir, "roon.json"));
    links.push(link);
    expect(link.view()).toMatchObject({ enabled: false, host: "192.0.2.20", port: 9330, extensionName: "hqpweb 0a1b" });
    expect(link.view().zoneFor).toEqual(before.zoneFor);
    link.setZone("office", "another-zone");
    const saved = json(dir, "roon.json");
    expect(saved).toMatchObject({ ...before, format: SETTINGS_FORMAT, zoneFor: { ...before.zoneFor, office: "another-zone" } });
  });

  it("warns, but still loads, when a file comes from a newer hqpweb", () => {
    const dir = fresh();
    saveConfig(dir, loadConfig(dir));
    const raw = json(dir, "instances.json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const newer = { ...raw, format: SETTINGS_FORMAT + 1 };
    writeFileSync(join(dir, "instances.json"), JSON.stringify(newer));
    expect(loadConfig(dir).instances).toEqual(raw.instances);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/newer hqpweb/));
  });
});
