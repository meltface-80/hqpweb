import { buildApp } from "./app.ts";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { LearnedStore } from "./learned.ts";

// Loopback by default, because the app has no login (design §7). In a container,
// set HOST=0.0.0.0 and let network placement be the gate. An authenticating
// proxy in front is optional, not required.
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
// Names the app is reached by, besides loopback (e.g. its internal DNS name or
// tailnet name). Requests under any other Host are refused.
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const config = loadConfig();
const configDir = process.env.CONFIG_DIR ?? "config";
try {
  accessSync(configDir, constants.W_OK);
} catch {
  console.error(`warning: ${configDir} is not writable; learned failures won't be saved (rollback still works)`);
}
const learned = new LearnedStore(join(configDir, "learned.json"));
// Set in the container image; in development Vite serves the web app instead.
const staticDir = process.env.STATIC_DIR || undefined;
const app = buildApp(config, { allowedHosts, learned, ...(staticDir ? { staticDir } : {}) });
const url = await app.listen(port, host);
console.error(`api on ${url} — instances: ${config.instances.map((i) => `${i.id}=${i.host}:${i.port}`).join(", ")}`);
if (allowedHosts.length) console.error(`also answering to: ${allowedHosts.join(", ")}`);
