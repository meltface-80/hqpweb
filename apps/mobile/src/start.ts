// The phone app's page: the web app (apps/web App.svelte) with the core running in-process
// instead of a server (packages/core localApi). The page hides what this host can't do (can).
// Started by main.ts with the phone's own parts (native TCP, device storage), and by the
// browser tests' build of the app (e2e/app-host) with stand-ins for those two only.
import { mount } from "svelte";
import "../../web/src/theme.css";
import App from "../../web/src/App.svelte";
import { applyTheme } from "../../web/src/lib/prefs.svelte.ts";
import { useHost } from "../../web/src/lib/api.ts";
import type { HostApi } from "@app/contract";
import {
  HistoryStore,
  LearnedStore,
  PresetStore,
  RoonLink,
  Service,
  loadConfig,
  localApi,
  localRoonApi,
  parseChange,
  roonTransportFor,
  type DocStore,
  type ServiceOptions,
} from "@app/core";
import type { Connect } from "@app/protocol";
import { APP_CAN, APP_NAME } from "./can.ts";

const unavailable = () => Promise.reject(new Error("not available in this app yet"));

export interface AppParts {
  /** How HQPlayer is reached. */
  connect: Connect;
  /** Where what's kept lives. */
  docs: DocStore;
  /** Tests: shorter timings, as the server's tests use. */
  tuning?: Pick<ServiceOptions, "timing" | "playWaitMs" | "queueEveryMs" | "pollMs">;
}

export async function startApp(target: HTMLElement, { connect, docs, tuning }: AppParts) {
  applyTheme();
  /** What start-up is doing, on screen until the page mounts; and why, if it can't. */
  const say = (text: string) => (target.textContent = text);
  try {
    say("Opening what this phone keeps…");
    const config = await loadConfig(docs, true);
    const [learned, history, presets, roon] = await Promise.all([
      LearnedStore.open(docs),
      HistoryStore.open(docs),
      PresetStore.open(docs, parseChange),
      RoonLink.open(docs, { version: __APP_VERSION__, name: APP_NAME }),
    ]);
    say("Starting…");
    const service = new Service(config, {
      net: { connect, discover: async () => [] },
      docs,
      learned,
      history,
      presets,
      roonTransport: roonTransportFor(roon),
      ...tuning,
    });
    const host: HostApi = {
      health: async () => ({ ok: true, version: __APP_VERSION__ }),
      calibrate: unavailable,
      ...localRoonApi(roon, service),
    };
    useHost({ api: { ...localApi(service, { roon }), ...host }, can: APP_CAN, name: APP_NAME });
    // Writes wait a moment to batch (docs.ts); the phone may stop the app any time after it's
    // hidden, so finish them then. Roon's pairing token is among them.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void Promise.all([learned.flush(), history.flush(), roon.flush()]);
    });
    target.textContent = "";
    mount(App, { target });
  } catch (e) {
    say(`${APP_NAME} couldn't start: ${(e as Error).message}`);
    throw e;
  }
}
