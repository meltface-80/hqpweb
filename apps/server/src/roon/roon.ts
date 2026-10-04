// Optional link to a Roon Core, for now-playing and transport on zones that feed
// HQPlayer. Off unless the user switches it on in Settings; nothing else in the
// app depends on it.
//
// Protocol as in Roon's Apache-2.0 node-roon-api (lib.js, moo.js,
// node-roon-api-transport); no code copied. Measured against a real core
// (2.73): discovery, the port (9330), approval and token reuse, HQPlayer zones
// carrying a source control named "HQPlayer", transport control and seek.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { SETTINGS_FORMAT, checkFormat } from "../format.ts";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { decode, encode, type MooMessage } from "./moo.ts";
import { HttpError } from "../instance.ts";
import { VERSION } from "../version.ts";

export const ROON_ACTIONS = ["play", "pause", "playpause", "previous", "next"] as const;
export type RoonAction = (typeof ROON_ACTIONS)[number];
export const DEFAULT_ROON_PORT = 9330;
/** Art is requested scaled to ≤ 1000 px; anything far bigger is not art. */
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_MESSAGE = 8 * 1024 * 1024;

export interface RoonSettings {
  /**
   * Makes this install's extension id unique. A core keeps one connection per
   * extension id and closes the older one when another registers (measured), so
   * two installs sharing an id would keep knocking each other off.
   */
  installId: string;
  enabled: boolean;
  host?: string;
  port?: number;
  /** Approval tokens per core_id, so a restart doesn't need re-approval in Roon. */
  tokens: Record<string, string>;
  /** HQPlayer instance id → Roon zone id. Roon doesn't say which HQPlayer a zone uses. */
  zoneFor: Record<string, string>;
}

export type RoonStatus = "off" | "connecting" | "unapproved" | "connected" | "unreachable";

export interface ZoneView {
  id: string;
  name: string;
  state: string;
  /** An output of this zone has a source control named "HQPlayer". */
  hqplayer: boolean;
  nowPlaying: { track: string; artist: string; album: string; imageKey?: string; seek?: number; length?: number } | null;
  allowed: { play: boolean; pause: boolean; next: boolean; previous: boolean; seek: boolean };
}

export interface RoonView {
  enabled: boolean;
  host?: string;
  port?: number;
  status: RoonStatus;
  error?: string;
  core?: { name: string; version: string };
  /** The name this install has in Roon → Settings → Extensions. */
  extensionName: string;
  zones: ZoneView[];
  zoneFor: Record<string, string>;
}

interface RawZone {
  zone_id: string;
  display_name: string;
  state?: string;
  is_play_allowed?: boolean;
  is_pause_allowed?: boolean;
  is_next_allowed?: boolean;
  is_previous_allowed?: boolean;
  is_seek_allowed?: boolean;
  now_playing?: {
    seek_position?: number;
    length?: number;
    image_key?: string;
    three_line?: { line1?: string; line2?: string; line3?: string };
  };
  outputs?: { source_controls?: { display_name?: string }[] }[];
}

const newInstallId = () => randomBytes(4).toString("hex");
const extensionName = (installId: string) => `hqpweb ${installId.slice(0, 4)}`;
const EXTENSION = {
  display_version: VERSION,
  publisher: "hqpweb",
  email: "",
  website: "https://github.com/statelycurmudgeon/hqpweb",
};
const TRANSPORT = "com.roonlabs.transport:2";
const PING = "com.roonlabs.ping:1";
const PAIRING = "com.roonlabs.pairing:1";

export function zoneView(z: RawZone): ZoneView {
  const np = z.now_playing;
  const three = np?.three_line;
  return {
    id: z.zone_id,
    name: z.display_name,
    state: z.state ?? "stopped",
    hqplayer: (z.outputs ?? []).some((o) => (o.source_controls ?? []).some((s) => s.display_name === "HQPlayer")),
    nowPlaying: np
      ? {
          track: three?.line1 ?? "",
          artist: three?.line2 ?? "",
          album: three?.line3 ?? "",
          ...(np.image_key ? { imageKey: np.image_key } : {}),
          ...(np.seek_position != null ? { seek: np.seek_position } : {}),
          ...(np.length != null ? { length: np.length } : {}),
        }
      : null,
    allowed: {
      play: !!z.is_play_allowed,
      pause: !!z.is_pause_allowed,
      next: !!z.is_next_allowed,
      previous: !!z.is_previous_allowed,
      seek: !!z.is_seek_allowed,
    },
  };
}

const stringMap = (v: unknown): Record<string, string> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"))
    : {};

/** A host name or IPv4 address, nothing that could reshape the URL. */
export const validRoonHost = (h: string) => /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(h);

export interface RoonOptions {
  /** Liveness check interval: Node's WebSocket can't send pings, so a cheap request stands in. */
  aliveMs?: number;
  /** Reply deadline for requests. */
  replyMs?: number;
  /** First reconnect delay; doubles up to 30 s. */
  reconnectMs?: number;
}

export class RoonLink {
  private settings: RoonSettings = { installId: newInstallId(), enabled: false, tokens: {}, zoneFor: {} };
  private readonly path: string | null;
  private readonly opts: Required<RoonOptions>;
  private ws: WebSocket | null = null;
  private gen = 0;
  private nextId = 0;
  private pending = new Map<string, { done: (m: MooMessage | null) => void; keep: boolean }>();
  private zones = new Map<string, RawZone>();
  private status: RoonStatus = "off";
  private error: string | undefined;
  private core: { id: string; name: string; version: string } | undefined;
  private listeners = new Set<() => void>();
  private aliveTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs: number;
  private closed = false;

  constructor(path: string | null, opts: RoonOptions = {}) {
    this.path = path;
    this.opts = { aliveMs: 30_000, replyMs: 10_000, reconnectMs: 2000, ...opts };
    this.retryMs = this.opts.reconnectMs;
    let needsSave = false;
    if (path && existsSync(path)) {
      try {
        const s = JSON.parse(readFileSync(path, "utf8")) as Partial<RoonSettings>;
        checkFormat(path, s);
        const hasId = typeof s.installId === "string" && /^[0-9a-f]{8}$/.test(s.installId);
        // A newly made install id must survive restarts, or every restart would need re-approval.
        needsSave = !hasId;
        this.settings = {
          installId: hasId ? (s.installId as string) : newInstallId(),
          enabled: s.enabled === true,
          ...(typeof s.host === "string" && validRoonHost(s.host) ? { host: s.host } : {}),
          ...(Number.isInteger(s.port) ? { port: s.port as number } : {}),
          tokens: stringMap(s.tokens),
          zoneFor: stringMap(s.zoneFor),
        };
      } catch (e) {
        const aside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        try {
          renameSync(path, aside);
        } catch {}
        console.error(`could not read ${path} (${(e as Error).message}); moved it to ${aside}; Roon is off`);
      }
    }
    if (needsSave) this.save();
    if (this.settings.enabled && this.settings.host) this.connect();
  }

  view(): RoonView {
    return {
      enabled: this.settings.enabled,
      ...(this.settings.host ? { host: this.settings.host } : {}),
      ...(this.settings.port ? { port: this.settings.port } : {}),
      status: this.status,
      ...(this.error ? { error: this.error } : {}),
      ...(this.core ? { core: { name: this.core.name, version: this.core.version } } : {}),
      extensionName: extensionName(this.settings.installId),
      zones: [...this.zones.values()]
        .map(zoneView)
        .sort((a, b) => Number(b.hqplayer) - Number(a.hqplayer) || a.name.localeCompare(b.name)),
      zoneFor: { ...this.settings.zoneFor },
    };
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }
  get currentStatus(): RoonStatus {
    return this.status;
  }

  /** The zone mapped to an instance, if Roon is connected and the zone exists. */
  zoneFor(instanceId: string): ZoneView | null {
    const id = this.settings.zoneFor[instanceId];
    const z = id ? this.zones.get(id) : undefined;
    return z && this.status === "connected" ? zoneView(z) : null;
  }

  /** Called on any status or zone change. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  configure(next: { enabled?: boolean; host?: string; port?: number }): RoonView {
    if (next.host !== undefined && !validRoonHost(next.host))
      throw new HttpError(400, "host must be a host name or IPv4 address");
    if (next.port !== undefined && !(Number.isInteger(next.port) && next.port > 0 && next.port < 65536))
      throw new HttpError(400, "port must be 1–65535");
    const before = JSON.stringify([this.settings.enabled, this.settings.host, this.settings.port]);
    if (next.enabled !== undefined) this.settings.enabled = next.enabled;
    if (next.host !== undefined) this.settings.host = next.host;
    if (next.port !== undefined) this.settings.port = next.port;
    this.save();
    if (JSON.stringify([this.settings.enabled, this.settings.host, this.settings.port]) !== before) {
      this.disconnect();
      if (this.settings.enabled && this.settings.host) this.connect();
      else
        this.setStatus(this.settings.enabled ? "unreachable" : "off", this.settings.enabled ? "no core address set" : undefined);
    }
    return this.view();
  }

  setZone(instanceId: string, zoneId: string | null): RoonView {
    if (zoneId === null) delete this.settings.zoneFor[instanceId];
    else this.settings.zoneFor[instanceId] = zoneId;
    this.save();
    this.emit();
    return this.view();
  }

  forgetInstance(instanceId: string) {
    if (this.settings.zoneFor[instanceId] === undefined) return;
    delete this.settings.zoneFor[instanceId];
    this.save();
  }

  async control(instanceId: string, action: RoonAction): Promise<ZoneView> {
    const zone = this.zoneFor(instanceId);
    if (!zone) throw new HttpError(409, "no Roon zone for this instance (Settings → Roon)");
    const reply = await this.request(`${TRANSPORT}/control`, { zone_or_output_id: zone.id, control: action });
    if (reply.name !== "Success") throw new HttpError(502, `Roon refused ${action}: ${reply.name}`);
    return this.zoneFor(instanceId) ?? zone;
  }

  async seek(instanceId: string, seconds: number): Promise<ZoneView> {
    const zone = this.zoneFor(instanceId);
    if (!zone) throw new HttpError(409, "no Roon zone for this instance (Settings → Roon)");
    const reply = await this.request(`${TRANSPORT}/seek`, {
      zone_or_output_id: zone.id,
      how: "absolute",
      seconds: Math.round(seconds),
    });
    if (reply.name !== "Success") throw new HttpError(502, `Roon refused seek: ${reply.name}`);
    return this.zoneFor(instanceId) ?? zone;
  }

  /** Album art from the core's plain-HTTP image endpoint (no MOO needed). */
  async image(key: string, size: number): Promise<{ type: string; data: Buffer }> {
    if (this.status !== "connected" || !this.settings.host) throw new HttpError(409, "Roon not connected");
    const port = this.settings.port ?? DEFAULT_ROON_PORT;
    const url = `http://${this.settings.host}:${port}/api/image/${encodeURIComponent(key)}?scale=fit&width=${size}&height=${size}&format=image/jpeg`;
    let r: Response;
    try {
      // No redirects: the core is the only host this may fetch from.
      r = await fetch(url, { signal: AbortSignal.timeout(this.opts.replyMs), redirect: "manual" });
    } catch (e) {
      throw new HttpError(502, `Roon image: ${(e as Error).message}`);
    }
    if (r.status !== 200) throw new HttpError(r.status === 404 ? 404 : 502, `Roon image: HTTP ${r.status}`);
    if (Number(r.headers.get("content-length") ?? 0) > MAX_IMAGE) throw new HttpError(502, "Roon image too large");
    // Count bytes as they arrive: a hostile "core" mustn't be able to fill memory.
    const chunks: Uint8Array[] = [];
    let received = 0;
    for await (const chunk of r.body ?? []) {
      received += chunk.length;
      if (received > MAX_IMAGE) {
        await r.body?.cancel().catch(() => {});
        throw new HttpError(502, "Roon image too large");
      }
      chunks.push(chunk);
    }
    return { type: r.headers.get("content-type") ?? "", data: Buffer.concat(chunks) };
  }

  close() {
    this.closed = true;
    this.disconnect();
    this.listeners.clear();
  }

  // ---- connection ----

  private connect() {
    const gen = ++this.gen;
    const url = `ws://${this.settings.host}:${this.settings.port ?? DEFAULT_ROON_PORT}/api`;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.lost(gen, (e as Error).message);
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    // A connect that neither opens nor fails (a silent firewall) must not hang.
    const opening = setTimeout(
      () => gen === this.gen && ws.readyState === WebSocket.CONNECTING && (ws.close(), this.lost(gen, `can't connect to ${url}`)),
      this.opts.replyMs,
    );
    ws.onopen = () => {
      clearTimeout(opening);
      if (gen === this.gen) this.handshake(gen);
    };
    ws.onmessage = (ev) => {
      if (gen !== this.gen) return;
      let msg: MooMessage;
      const size = typeof ev.data === "string" ? ev.data.length : (ev.data as ArrayBuffer).byteLength;
      if (size === 0) return this.emptyFrame();
      // Zone lists are tens of KB; anything this big is not a Roon core.
      if (size > MAX_MESSAGE) {
        ws.close();
        this.lost(gen, "Roon message too large");
        return;
      }
      try {
        msg = decode(ev.data as ArrayBuffer | string);
      } catch (e) {
        const raw = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString("utf8");
        console.error(`roon: dropping connection: ${(e as Error).message}; message began ${JSON.stringify(raw.slice(0, 160))}`);
        ws.close();
        this.lost(gen, (e as Error).message);
        return;
      }
      this.dispatch(msg);
    };
    ws.onerror = () => {};
    ws.onclose = () => this.lost(gen, this.status === "connecting" ? `can't connect to ${url}` : "connection closed");
  }

  private async handshake(gen: number) {
    try {
      const info = await this.request("com.roonlabs.registry:1/info");
      const body = info.body as { core_id: string; display_name: string; display_version: string };
      this.core = { id: body.core_id, name: body.display_name, version: body.display_version };
      const token = this.settings.tokens[body.core_id];
      // Liveness from here on, so a core that vanishes while we wait for approval is noticed.
      this.aliveTimer = setInterval(() => {
        this.request("com.roonlabs.registry:1/info").catch(() => {
          if (gen === this.gen) this.ws?.close();
        });
      }, this.opts.aliveMs);
      // With a token the core answers at once; without one (or if the core no longer
      // accepts it) the user must approve. Say so after a moment rather than at once,
      // so an approved reconnect doesn't flash "waiting for approval".
      let approvalHint: ReturnType<typeof setTimeout> | undefined;
      if (!token) this.setStatus("unapproved");
      else
        approvalHint = setTimeout(() => gen === this.gen && this.status === "connecting" && this.setStatus("unapproved"), 3000);
      // Unapproved, this reply only comes once the user enables the extension in
      // Roon (Settings → Extensions); until then the request stays open.
      const reg = await new Promise<MooMessage>((resolve, reject) =>
        this.send(
          "REQUEST",
          "com.roonlabs.registry:1/register",
          {
            extension_id: `com.github.hqpweb.${this.settings.installId}`,
            display_name: extensionName(this.settings.installId),
            ...EXTENSION,
            required_services: [TRANSPORT],
            optional_services: [],
            provided_services: [PING, PAIRING],
            ...(token ? { token } : {}),
          },
          (m) => {
            // node-roon-api acts only on "Registered"; anything else before it is ignored.
            if (!m) reject(new Error("Roon connection lost"));
            else if (m.name === "Registered") resolve(m);
            else if (m.verb === "COMPLETE") reject(new Error(`Roon said ${m.name}`));
          },
          true,
        ),
      );
      clearTimeout(approvalHint);
      if (gen !== this.gen) return;
      const r = reg.body as { core_id: string; token?: string };
      if (r.token && this.settings.tokens[r.core_id] !== r.token) {
        this.settings.tokens[r.core_id] = r.token;
        this.save();
      }
      this.retryMs = this.opts.reconnectMs;
      this.zones.clear();
      this.subscribeZones();
      this.setStatus("connected");
    } catch (e) {
      if (gen !== this.gen) return;
      this.ws?.close();
      this.lost(gen, (e as Error).message);
    }
  }

  /**
   * The core sends an empty frame, then closes, when another connection registers
   * with the same extension id (measured). Wait longer before retrying, so two
   * processes sharing one config don't take turns knocking each other off.
   */
  private emptyFrame() {
    const gen = this.gen;
    this.retryMs = 30_000;
    this.ws?.close();
    this.lost(gen, "another connection with this install's Roon approval took over");
  }

  private subscribeZones() {
    this.send(
      "REQUEST",
      `${TRANSPORT}/subscribe_zones`,
      { subscription_key: 0 },
      (m) => {
        if (!m) return;
        const b = (m.body ?? {}) as {
          zones?: RawZone[];
          zones_added?: RawZone[];
          zones_changed?: RawZone[];
          zones_removed?: string[];
          zones_seek_changed?: { zone_id: string; seek_position?: number }[];
        };
        if (m.name === "Subscribed") {
          this.zones.clear();
          for (const z of b.zones ?? []) this.zones.set(z.zone_id, z);
        } else if (m.name === "Changed") {
          for (const id of b.zones_removed ?? []) this.zones.delete(id);
          for (const z of [...(b.zones_added ?? []), ...(b.zones_changed ?? [])]) this.zones.set(z.zone_id, z);
          for (const s of b.zones_seek_changed ?? []) {
            const z = this.zones.get(s.zone_id);
            if (z?.now_playing && s.seek_position != null) z.now_playing.seek_position = s.seek_position;
          }
        }
        this.emit();
      },
      true,
    );
  }

  /** The core also calls us: ping, and the pairing service every extension provides. */
  private answer(m: MooMessage) {
    const reply = (verb: "CONTINUE" | "COMPLETE", name: string, body?: unknown) =>
      this.ws?.send(encode(verb, name, m.requestId, body));
    const paired = { paired_core_id: this.core?.id };
    if (m.service === PING && m.name === "ping") reply("COMPLETE", "Success");
    else if (m.service === PAIRING && m.name === "subscribe_pairing") reply("CONTINUE", "Subscribed", paired);
    else if (m.service === PAIRING && m.name === "unsubscribe_pairing") reply("COMPLETE", "Unsubscribed");
    else if (m.service === PAIRING && (m.name === "get_pairing" || m.name === "pair")) reply("COMPLETE", "Success", paired);
    else reply("COMPLETE", "InvalidRequest", { error: `unknown request ${m.service}/${m.name}` });
  }

  private dispatch(m: MooMessage) {
    if (m.verb === "REQUEST") return this.answer(m);
    const p = this.pending.get(m.requestId);
    if (!p) return;
    if (m.verb === "COMPLETE" || !p.keep) this.pending.delete(m.requestId);
    p.done(m);
  }

  private send(verb: "REQUEST", name: string, body: unknown, done: (m: MooMessage | null) => void, keep = false) {
    const id = String(this.nextId++);
    this.pending.set(id, { done, keep });
    try {
      this.ws!.send(encode(verb, name, id, body));
    } catch (e) {
      this.pending.delete(id);
      done(null);
    }
  }

  private request(name: string, body?: unknown): Promise<MooMessage> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new HttpError(409, "Roon not connected"));
      const id = String(this.nextId);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HttpError(504, `Roon didn't answer ${name}`));
      }, this.opts.replyMs);
      this.send("REQUEST", name, body, (m) => {
        clearTimeout(timer);
        if (m) resolve(m);
        else reject(new HttpError(502, "Roon connection lost"));
      });
    });
  }

  private lost(gen: number, why: string) {
    if (gen !== this.gen) return;
    this.teardown();
    if (this.closed) return;
    if (!this.settings.enabled) return this.setStatus("off");
    this.setStatus("unreachable", why);
    this.retryTimer = setTimeout(() => gen === this.gen && this.connect(), this.retryMs);
    this.retryMs = Math.min(30_000, this.retryMs * 2);
  }

  private teardown() {
    if (this.aliveTimer) clearInterval(this.aliveTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.aliveTimer = this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onopen = null;
      try {
        ws.close();
      } catch {}
    }
    for (const p of this.pending.values()) p.done(null);
    this.pending.clear();
    this.zones.clear();
  }

  private disconnect() {
    this.gen++;
    this.teardown();
    this.core = undefined;
    this.retryMs = this.opts.reconnectMs;
  }

  private setStatus(s: RoonStatus, error?: string) {
    this.status = s;
    this.error = error;
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) {
      try {
        l();
      } catch {}
    }
  }

  private save() {
    if (!this.path || this.closed) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    // The file holds Roon approval tokens: owner-only, even if a stale tmp exists.
    rmSync(tmp, { force: true });
    writeFileSync(tmp, JSON.stringify({ format: SETTINGS_FORMAT, ...this.settings }, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
