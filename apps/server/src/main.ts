import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

// Loopback by default, because the app has no login (design §7). In a container,
// set HOST=0.0.0.0 and let network placement be the gate. An authenticating
// proxy in front is optional, not required.
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);

const config = loadConfig();
const app = buildApp(config);
await app.listen({ host, port });
console.error(`api on http://${host}:${port} — instances: ${config.instances.map((i) => `${i.id}=${i.host}:${i.port}`).join(", ")}`);
