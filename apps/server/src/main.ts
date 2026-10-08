import { buildApp, parseChange } from "./app.ts";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { LearnedStore } from "./learned.ts";
import { HistoryStore } from "./history.ts";
import { PresetStore } from "./presets.ts";
import { RoonLink } from "./roon/roon.ts";

// Loopback by default, because the app has no login (design §7). In a container,
// set HOST=0.0.0.0 and let network placement be the gate. An authenticating
// proxy in front is optional, not required.
const host = process.env.HOST ?? "127.0.0.1";
// 4380: unassigned in the IANA registry, and clear of common self-hosted defaults.
const port = Number(process.env.PORT ?? 4380);
// Names the app is reached by, besides loopback (e.g. its internal DNS name or
// tailnet name). Requests under any other Host are refused.
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const config = loadConfig();
const configDir = process.env.CONFIG_DIR ?? "config";
try {
  accessSync(configDir, constants.W_OK);
} catch {
  console.error(`warning: ${configDir} is not writable; learned failures won't be saved (rollback still works)`);
}
const learned = new LearnedStore(join(configDir, "learned.json"));
const history = new HistoryStore(join(configDir, "history.json"));
// Set in the container image; in development Vite serves the web app instead.
const staticDir = process.env.STATIC_DIR || undefined;
// Discovery is UDP multicast: in Docker it needs host networking to see the LAN.
// DISCOVERY=off disables it; DISCOVERY_TARGET=host:port probes one address (dev).
const target = process.env.DISCOVERY_TARGET?.match(/^(.+):(\d+)$/);
const discovery =
  process.env.DISCOVERY === "off" ? (false as const) : target ? { target: { address: target[1]!, port: Number(target[2]) } } : {};
const presets = new PresetStore(join(configDir, "presets.json"), parseChange);
// Roon is optional and off until switched on in Settings.
const roon = new RoonLink(join(configDir, "roon.json"));
const app = buildApp(config, {
  allowedHosts,
  learned,
  history,
  presets,
  configDir,
  discovery,
  roon,
  ...(staticDir ? { staticDir } : {}),
});
const url = await app.listen(port, host);
console.error(`api on ${url} — instances: ${config.instances.map((i) => `${i.id}=${i.host}:${i.port}`).join(", ")}`);
if (allowedHosts.length) console.error(`also answering to: ${allowedHosts.join(", ")}`);

// `docker compose down` sends SIGTERM. Node as PID 1 ignores it by default, so
// without this the container waits 10 s and gets killed.
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref();
    void app.close().finally(() => process.exit(0));
  });
