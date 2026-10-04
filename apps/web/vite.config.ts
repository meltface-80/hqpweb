import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import pkg from "../../package.json" with { type: "json" };
import { fileURLToPath } from "node:url";
import { buildCommit } from "../server/src/commit.ts";

// Remote dev goes through `tailscale serve`, which forwards to this loopback-only
// dev server with the tailnet hostname in Host. List such names in
// ALLOWED_HOSTS (comma-separated; the API server reads the same variable)
// rather than committing them.
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "").split(",").filter(Boolean);

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(buildCommit(fileURLToPath(new URL("../../", import.meta.url)))),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    allowedHosts,
    proxy: { "/api": `http://127.0.0.1:${process.env.PORT ?? 4380}` },
  },
});
