// What the phone app's page can offer (apps/web api.ts can), and what it's called, apart for the
// browser tests to read.
import type { HostCan } from "@app/contract";

/** What this app can't do yet: an always-on watch, the clap track, multicast discovery (HQPlayer's or Roon's). */
export const APP_CAN: HostCan = { restartCap: false, calibrate: false, roon: true, discover: false };

/** The app's name, for now (owner, 2026-10-11): on the home screen, in the page, and in Roon's Extensions. */
export const APP_NAME = "hqpmob";
