// The page's way to hqpweb: the API over HTTP (httpApi), and small shared formatting helpers.

import type { Api, Change, Failure, Host, HostCan } from "@app/contract";
export type * from "@app/contract";

export interface HttpApiOptions {
  /** Where the server is; "" (the default) is this page's own origin. */
  base?: string;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
}

/**
 * The API over HTTP: the self-hosted server (apps/server app.ts). Its calls and the JSON
 * they carry are @app/contract's; an app could serve the same `CoreApi` in-process instead.
 */
export function httpApi(opts: HttpApiOptions = {}): Api {
  const base = opts.base ?? "";
  // Looked up at each call, not now, so a page (or a test) can replace them.
  const doFetch = (input: string, init?: RequestInit) => (opts.fetch ?? fetch)(input, init);
  const Source = () => opts.EventSource ?? EventSource;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await doFetch(base + path, init);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
    return body as T;
  }
  const send = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const inst = (id: string) => `/api/instances/${id}`;
  /** A server-sent-events stream: each named event's JSON to its handler. Returns how to stop. */
  function stream(path: string, events: Record<string, (data: never) => void>, lost?: () => void): () => void {
    const es = new (Source())(base + path);
    for (const [name, fn] of Object.entries(events))
      es.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data) as never));
    if (lost) es.onerror = () => lost();
    return () => es.close();
  }

  return {
    health: () => call("/api/health"),
    instances: () => call("/api/instances"),
    addInstance: (body) => call("/api/instances", send("POST", body)),
    renameInstance: (id, name) => call(inst(id), send("PATCH", { name })),
    setRestartCap: (id, maxDb) => call(`/api/instances/${encodeURIComponent(id)}/restartcap`, send("PUT", { maxDb })),
    saveSetup: (id, change) => call(`${inst(id)}/setup`, send("PUT", change)),
    removeInstance: (id) => call(inst(id), { method: "DELETE" }),
    // Named DACs behind one HQPlayer (server: dac-scope.ts).
    addDac: (id, name, currentName) => call(`${inst(id)}/dacs`, send("POST", { name, ...(currentName ? { currentName } : {}) })),
    renameDac: (id, dac, name) => call(`${inst(id)}/dacs/${encodeURIComponent(dac)}`, send("PATCH", { name })),
    removeDac: (id, dac) => call(`${inst(id)}/dacs/${encodeURIComponent(dac)}`, { method: "DELETE" }),
    selectDac: (id, dac) => call(`${inst(id)}/dac`, send("PUT", { dac })),
    discover: () => call("/api/discover", { method: "POST" }),
    capabilities: (id) => call(`${inst(id)}/capabilities`),
    change: (id, change) => call(`${inst(id)}/change`, send("POST", change)),
    transport: (id, action) => call(`${inst(id)}/transport`, send("POST", { action })),
    undo: (id) => call(`${inst(id)}/undo`, { method: "POST" }),
    calibrate: (id) => call(`${inst(id)}/calibrate`, { method: "POST" }),
    dismissVolumeJump: (id) => call(`${inst(id)}/dismissjump`, { method: "POST" }),
    presets: (id) => call(`${inst(id)}/presets`),
    savePreset: (body) => call("/api/presets", send("POST", body)),
    renamePreset: (pid, name) => call(`/api/presets/${pid}`, send("PATCH", { name })),
    updatePresetFromCurrent: (pid, fromInstance) => call(`/api/presets/${pid}`, send("PATCH", { fromInstance })),
    deletePreset: (pid) => call(`/api/presets/${pid}`, { method: "DELETE" }),
    applyPreset: (id, pid) => call(`${inst(id)}/presets/${pid}/apply`, { method: "POST" }),
    learned: (id) => call(`${inst(id)}/learned`),
    history: (id) => call(`${inst(id)}/history`),
    forgetLearned: (id) => call(`${inst(id)}/learned`, { method: "DELETE" }),
    forgetCombo: (id, c) =>
      call(
        `${inst(id)}/forget`,
        send("POST", { mode: c.mode, rateHz: c.rateHz, filter1x: c.filter1x, filterNx: c.filterNx, shaper: c.shaper }),
      ),
    status: (id, on) =>
      stream(
        `${inst(id)}/events`,
        {
          now: on.now,
          unreachable: (d: { error: string }) => on.unreachable(d.error),
          // Only sent when Roon is switched on in Settings.
          ...(on.roon ? { roon: on.roon } : {}),
        },
        on.lost,
      ),
    meter: (id, on) => stream(`${inst(id)}/meter`, { meter: on }),
    roon: () => call("/api/roon"),
    configureRoon: (body) => call("/api/roon", send("PUT", body)),
    discoverRoon: () => call("/api/roon/discover", { method: "POST" }),
    setRoonZone: (id, zone) => call(`${inst(id)}/roonzone`, send("PUT", { zone })),
    seek: (id, seconds) => call(`${inst(id)}/seek`, send("POST", { seconds })),
    roonSeek: (id, seconds) => call(`${inst(id)}/roonseek`, send("POST", { seconds })),
    roonTransport: (id, action) => call(`${inst(id)}/roontransport`, send("POST", { action })),
    roonArtUrl: (key, size) => `${base}/api/roon/art/${encodeURIComponent(key)}?size=${size}`,
  };
}

/** Everything, as the self-hosted server offers it. */
export const SERVER_CAN: HostCan = { restartCap: true, calibrate: true, roon: true, discover: true };

/** The page's API, and what its host can do: its own server, unless a host says otherwise. */
export let api: Api = httpApi();
export let can: HostCan = SERVER_CAN;
/** What the page calls itself (Host.name): the server's "hqpweb" unless a host says otherwise. */
export let appName = "hqpweb";

/**
 * Called by a host (a phone app) before the page mounts: its API (the core in-process) and
 * what it can do. Modules read `api` and `can` when they use them, so this takes effect everywhere.
 */
export function useHost(host: Host) {
  api = host.api;
  can = host.can;
  appName = host.name;
}

export const PLAYBACK = ["Stopped", "Paused", "Playing", "Stopping"];

/** "DSD256", "384 kHz", "1.536 MHz"; 0 is "Auto". */
/**
 * A rate as hqpweb writes it everywhere: DSD256, or PCM in kHz (1536 kHz). DSD is told from
 * the rate itself (DSD64, 2.8224 MHz, is above any PCM rate), not the mode, which can be
 * stale around a switch: that once wrote DSD256 as "11.2896 MHz". `_mode` is kept for callers.
 */
export function formatRate(hz: number, _mode?: string): string {
  if (!hz) return "Auto";
  if (hz >= 2_822_400) {
    if (hz % 44_100 === 0) return `DSD${hz / 44_100}`;
    if (hz % 48_000 === 0) return `DSD${hz / 48_000} (48k)`;
    return `${hz / 1_000_000} MHz`;
  }
  return `${hz / 1000} kHz`;
}

/** A mode as hqpweb writes it: HQPlayer's "SDM (DSD)" is DSD, as on the card's tabs. */
export const modeLabel = (name: string) => (name.startsWith("SDM") ? "DSD" : name);

/**
 * A field's name as the pickers show it. The shaper is a modulator in SDM and dither in PCM;
 * `sdm` undefined (mode unknown) names both.
 */
export const fieldLabel = (field: keyof Change, sdm?: boolean) =>
  field === "shaper" ? (sdm === undefined ? "Dither or modulator" : sdm ? "Modulator" : "Dither") : FIELD_LABEL[field];

export const FIELD_LABEL: Record<keyof Change, string> = {
  mode: "Mode",
  rate: "Rate",
  filterNx: "Nx filter",
  filter1x: "1x filter",
  shaper: "Modulator",
  volume: "Volume",
  invert: "Invert",
  filter20k: "20 kHz filter",
  adaptive: "Adaptive volume",
  convolution: "Convolution",
  matrixProfile: "Matrix profile",
};

export function knownBad(
  list: Failure[],
  combo: Pick<Failure, "mode" | "rateHz" | "filterNx" | "filter1x" | "shaper">,
): Failure | undefined {
  return list.find(
    (f) =>
      f.mode === combo.mode &&
      f.rateHz === combo.rateHz &&
      f.filterNx === combo.filterNx &&
      f.filter1x === combo.filter1x &&
      f.shaper === combo.shaper,
  );
}
