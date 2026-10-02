import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface InstanceConfig {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface AppConfig {
  instances: InstanceConfig[];
}

/** With no config file the app talks to the fake server only, never port 4321. */
export const DEV_DEFAULT: AppConfig = {
  instances: [{ id: "fake", name: "Fake (dev)", host: "127.0.0.1", port: 14321 }],
};

export function loadConfig(dir = process.env.CONFIG_DIR ?? "config"): AppConfig {
  const path = join(dir, "instances.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return DEV_DEFAULT;
  }
  const cfg = JSON.parse(raw) as AppConfig;
  const ids = new Set<string>();
  for (const i of cfg.instances) {
    if (!/^[a-z0-9-]+$/.test(i.id)) throw new Error(`${path}: instance id "${i.id}" must be [a-z0-9-]`);
    if (ids.has(i.id)) throw new Error(`${path}: duplicate instance id "${i.id}"`);
    ids.add(i.id);
  }
  return cfg;
}
