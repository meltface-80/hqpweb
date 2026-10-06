import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SETTINGS_FORMAT, checkFormat } from "./format.ts";

export interface InstanceConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  /**
   * Optional hard caps, e.g. what the DAC accepts. HQPlayer's own rate list
   * already seems to follow the output device (inferred from two instances);
   * these are a second line of defence. Rates above them are never offered.
   */
  limits?: { maxPcmRate?: number; maxDsdRate?: number };
  /** The listener's answers about this instance's DAC and use (setup.ts). Absent: not answered. */
  setup?: InstanceSetup;
}

/**
 * What the modulator and dither advice needs to know, and HQPlayer can't tell us.
 * Each answer is optional: unanswered questions keep the advice that needs them off.
 */
export interface InstanceSetup {
  /** How the DAC takes DSD (apps/web/src/lib/dacs.ts, DsdPath). */
  dsd?: "older-ess" | "remodulates" | "direct" | "converts";
  /** How the DAC converts PCM. */
  pcm?: "delta-sigma" | "ladder";
  /** How the signal reaches the DAC: USB or network (NAA), or S/PDIF, AES or optical. */
  link?: "usb" | "spdif";
  /** Whether HQPlayer is the volume control, or stays near 0 dB with the level set elsewhere. */
  volume?: "hqplayer" | "elsewhere";
}

export interface AppConfig {
  instances: InstanceConfig[];
}

/** With no config file the app talks to the fake server only, never port 4321. */
export const DEV_DEFAULT: AppConfig = {
  instances: [{ id: "fake", name: "Fake (dev)", host: "127.0.0.1", port: 14321 }],
};

export const ID_PATTERN = /^[a-z0-9-]+$/;

export function loadConfig(dir = process.env.CONFIG_DIR ?? "config"): AppConfig {
  const path = join(dir, "instances.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // Production starts empty (discovery and Settings fill it); development
    // starts with the fake so nothing can reach a real HQPlayer by accident.
    return process.env.NODE_ENV === "production" ? { instances: [] } : structuredClone(DEV_DEFAULT);
  }
  const cfg = JSON.parse(raw) as AppConfig;
  checkFormat(path, cfg);
  const ids = new Set<string>();
  for (const i of cfg.instances) {
    if (!ID_PATTERN.test(i.id)) throw new Error(`${path}: instance id "${i.id}" must be [a-z0-9-]`);
    if (ids.has(i.id)) throw new Error(`${path}: duplicate instance id "${i.id}"`);
    ids.add(i.id);
  }
  return cfg;
}

/** Write instances.json atomically. The app owns this file while it runs. */
export function saveConfig(dir: string, cfg: AppConfig) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "instances.json");
  writeFileSync(`${path}.tmp`, JSON.stringify({ format: SETTINGS_FORMAT, instances: cfg.instances }, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
}
