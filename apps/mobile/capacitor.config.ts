// The phone app, hqpmob for now (owner, 2026-10-11; can.ts APP_NAME): the web app (apps/web) with the
// core in-process (packages/core), on Capacitor. The id is a placeholder for builds on the owner's own
// devices, unchanged by the rename: a new id is a new app on the phone, without what this one keeps.
// It changes with the final name, before any store release.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.hqpweb.app",
  appName: "hqpmob",
  webDir: "dist",
};

export default config;
