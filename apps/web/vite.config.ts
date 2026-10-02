import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Remote dev goes through `tailscale serve`, which forwards to this loopback-only
// dev server with the tailnet hostname in Host. List such names in
// DEV_ALLOWED_HOSTS (comma-separated) rather than committing them.
const allowedHosts = (process.env.DEV_ALLOWED_HOSTS ?? "").split(",").filter(Boolean);

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    allowedHosts,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
