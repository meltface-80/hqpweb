// HTTP API on node:http, no framework.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import type { AppConfig } from "./config.ts";
import { HttpError, Instance, TRANSPORT_ACTIONS, type Change, type TransportAction } from "./instance.ts";
import { LearnedStore } from "./learned.ts";
import { HistoryStore } from "./history.ts";
import { serveStatic } from "./static.ts";
import { SECURITY_HEADERS } from "./headers.ts";
import { COMMIT, VERSION } from "./version.ts";
import { Registry } from "./registry.ts";
import { parseSetupChange } from "./setup.ts";
import { PresetStore } from "./presets.ts";
import { PeerError, type DiscoverOptions } from "@app/protocol";
import type { WatchTiming } from "./watch.ts";
import type { RoonTransport } from "./change-engine.ts";
import type { KeptTiming } from "./kept-up.ts";
import type { MeterTiming } from "./meter-stream.ts";
import { ROON_ACTIONS, RoonLink, type RoonAction } from "./roon/roon.ts";
import { discoverCores } from "./roon/sood.ts";
import { scopeOf } from "./dac-scope.ts";

export interface AppOptions {
  pollMs?: number;
  /**
   * Hostnames this server answers to, besides loopback. Anything else is refused,
   * which blocks DNS rebinding: a hostile page can point its own name at this
   * server, but the browser still sends that name in Host.
   */
  allowedHosts?: string[];
  /** Built web app to serve (production). Unset in development, where Vite serves it. */
  staticDir?: string;
  /** Where instances added in Settings are saved; unset = in memory only. */
  configDir?: string;
  /** Discovery settings; false disables it (tests default to false). */
  discovery?: DiscoverOptions | false;
  /** Control port assumed for discovered instances (default 4321). */
  discoveredPort?: number;
  /** Where presets are kept. Default: in memory only. */
  presets?: PresetStore;
  /** Where failed combinations are remembered. Default: in memory only. */
  learned?: LearnedStore;
  /** Change history and settings last seen per mode (history.ts). Default: in memory. */
  history?: HistoryStore;
  /** Playback-check timing; tests shorten it. */
  timing?: { quick: WatchTiming; major: WatchTiming };
  /** Live playback-speed window (default 30 s). */
  speedWindowMs?: number;
  /** Tests: shorten when a playing combination counts as settled (kept-up.ts). */
  keptTiming?: KeptTiming;
  /** Tests: shorten the meter stream's timing (meter-stream.ts). */
  meterTiming?: Partial<MeterTiming>;
  /** Playlist re-read interval while stopped (default 5 s). */
  queueEveryMs?: number;
  /** How long Play may take before "didn't start" (default 5 s). */
  playWaitMs?: number;
  /** Optional Roon link. Default: off, in memory only. */
  roon?: RoonLink;
  /** Tests: stand in for Roon's transport per instance (default: the RoonLink's linked zone). */
  roonTransport?: (instanceId: string) => RoonTransport | null;
}

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];
const MAX_BODY = 16 * 1024;

const FIELDS: Record<keyof Change, "name" | "number" | "rate" | "boolean"> = {
  mode: "name",
  rate: "rate",
  filterNx: "name",
  filter1x: "name",
  shaper: "name",
  volume: "number",
  invert: "boolean",
  filter20k: "boolean",
  adaptive: "boolean",
  convolution: "boolean",
  matrixProfile: "name",
};

/** Strict: no unknown fields, no type coercion ("-20" is not a volume). */
export function parseChange(body: unknown): Change {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const entries = Object.entries(body);
  if (entries.length === 0) throw new HttpError(400, "empty change");
  for (const [k, v] of entries) {
    const kind = FIELDS[k as keyof Change];
    if (!kind) throw new HttpError(400, `unknown field "${k}"`);
    const ok =
      kind === "name"
        ? typeof v === "string" && v.length > 0
        : kind === "number"
          ? typeof v === "number" && Number.isFinite(v)
          : kind === "rate"
            ? Number.isInteger(v) && (v as number) >= 0
            : typeof v === "boolean";
    const want = {
      name: "a non-empty string",
      number: "a number",
      rate: "a whole number of Hz (0 = auto)",
      boolean: "a boolean",
    }[kind];
    if (!ok) throw new HttpError(400, `"${k}" must be ${want}`);
  }
  return body as Change;
}

const hostnameOf = (hostHeader: string) => hostHeader.replace(/:\d+$/, "").toLowerCase();

/**
 * IP literals are always allowed as Host: DNS rebinding needs an attacker-chosen
 * hostname, so a request addressed to a bare IP can't be a rebinding attack.
 * Hostnames must be listed in ALLOWED_HOSTS.
 */
const isIpLiteral = (h: string) => isIP(h.replace(/^\[|\]$/g, "")) !== 0;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "expected application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function parsePresetBody(
  body: unknown,
  patch = false,
): { name?: string; settings?: Change; fromInstance?: string; includeVolume?: boolean; scope?: string | null } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const { name, settings, fromInstance, includeVolume, scope, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new HttpError(400, `unknown field "${Object.keys(rest)[0]}"`);
  if (name !== undefined && typeof name !== "string") throw new HttpError(400, "name must be a string");
  if (!patch && name === undefined) throw new HttpError(400, "name is required");
  if (fromInstance !== undefined && typeof fromInstance !== "string")
    throw new HttpError(400, "fromInstance must be an instance id");
  if (includeVolume !== undefined && typeof includeVolume !== "boolean")
    throw new HttpError(400, "includeVolume must be a boolean");
  // A DAC's scope (dac-scope.ts): "id" or "id#dac"; null (on a patch) shares it with all DACs.
  if (
    scope !== undefined &&
    !(scope === null && patch) &&
    !(typeof scope === "string" && /^[a-z0-9-]+(#[a-z0-9-]+)?$/.test(scope))
  )
    throw new HttpError(400, "scope must be an instance id, or id#dac");
  return {
    ...(name !== undefined ? { name: name as string } : {}),
    ...(settings !== undefined ? { settings: parseChange(settings) } : {}),
    ...(fromInstance !== undefined ? { fromInstance: fromInstance as string } : {}),
    ...(includeVolume !== undefined ? { includeVolume: includeVolume as boolean } : {}),
    ...(scope !== undefined ? { scope: scope as string | null } : {}),
  };
}

function parseRoonSettings(body: unknown): { enabled?: boolean; host?: string; port?: number } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const { enabled, host, port, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new HttpError(400, `unknown field "${Object.keys(rest)[0]}"`);
  if (enabled !== undefined && typeof enabled !== "boolean") throw new HttpError(400, "enabled must be a boolean");
  if (host !== undefined && typeof host !== "string") throw new HttpError(400, "host must be a string");
  if (port !== undefined && !Number.isInteger(port)) throw new HttpError(400, "port must be a whole number");
  return {
    ...(enabled !== undefined ? { enabled: enabled as boolean } : {}),
    ...(host !== undefined ? { host: (host as string).trim() } : {}),
    ...(port !== undefined ? { port: port as number } : {}),
  };
}

function parseNewInstance(body: unknown): { name: string; host: string; port?: number } {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "body must be a JSON object");
  const { name, host, port, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new HttpError(400, `unknown field "${Object.keys(rest)[0]}"`);
  if (typeof name !== "string" || typeof host !== "string") throw new HttpError(400, "name and host are required strings");
  if (port !== undefined && !Number.isInteger(port)) throw new HttpError(400, "port must be a whole number");
  return { name, host, ...(port !== undefined ? { port: port as number } : {}) };
}

type Handler = (req: IncomingMessage, res: ServerResponse, inst: Instance) => Promise<unknown> | void;

export function buildApp(config: AppConfig, opts: AppOptions = {}) {
  const learned = opts.learned ?? new LearnedStore(null);
  const history = opts.history ?? new HistoryStore(null);
  const presets = opts.presets ?? new PresetStore(null);
  const roon = opts.roon ?? new RoonLink(null);
  // Pausing for a mode switch goes through Roon when hqpweb has the instance's zone (change-engine.ts).
  const roonTransport =
    opts.roonTransport ??
    ((id: string): RoonTransport | null =>
      roon.zoneFor(id) ? { pause: () => roon.control(id, "pause"), play: () => roon.control(id, "play") } : null);
  const registry = new Registry(config, {
    configDir: opts.configDir ?? null,
    discovery: opts.discovery ?? false,
    ...(opts.discoveredPort ? { discoveredPort: opts.discoveredPort } : {}),
    makeInstance: (cfg) =>
      new Instance(cfg, {
        learned,
        history,
        ...(opts.timing ? { timing: opts.timing } : {}),
        ...(opts.speedWindowMs ? { speedWindowMs: opts.speedWindowMs } : {}),
        ...(opts.keptTiming ? { keptTiming: opts.keptTiming } : {}),
        ...(opts.meterTiming ? { meterTiming: opts.meterTiming } : {}),
        ...(opts.queueEveryMs ? { queueEveryMs: opts.queueEveryMs } : {}),
        ...(opts.playWaitMs ? { playWaitMs: opts.playWaitMs } : {}),
        roon: () => roonTransport(cfg.id),
      }),
  });
  const listedHosts = new Set((opts.allowedHosts ?? []).map((h) => h.toLowerCase()));
  const allowed = new Set([...LOOPBACK, ...listedHosts]);

  const events: Handler = (req, res, inst) => {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Stops reverse proxies from buffering the stream.
      "x-accel-buffering": "no",
    });
    res.write(": connected\n\n");
    const unsubscribe = inst.subscribe((e) => {
      if (e.snapshot) res.write(`event: now\ndata: ${JSON.stringify({ ...e.snapshot, health: e.health })}\n\n`);
      else res.write(`event: unreachable\ndata: ${JSON.stringify({ error: e.error })}\n\n`);
    }, opts.pollMs);
    // Roon now-playing for this instance's zone, only when Roon is switched on.
    // Roon reports the seek position every second. The page advances it itself, so
    // send it only with other changes or when it jumps (a seek, a stall).
    let lastRoon = "";
    let sent: { seek: number; at: number; playing: boolean } | null = null;
    const sendRoon = () => {
      if (!roon.enabled && lastRoon === "") return;
      const status = roon.currentStatus;
      const zone = roon.zoneFor(inst.cfg.id);
      const seek = zone?.nowPlaying?.seek;
      const { seek: _s, ...rest } = zone?.nowPlaying ?? {};
      const key = JSON.stringify({ status, zone: zone && { ...zone, nowPlaying: zone.nowPlaying && rest } });
      const playing = zone?.state === "playing";
      const expected = sent ? sent.seek + (sent.playing ? (Date.now() - sent.at) / 1000 : 0) : null;
      const jumped = seek != null && (expected == null || Math.abs(seek - expected) > 2);
      if (key === lastRoon && !jumped) return;
      lastRoon = key;
      sent = seek != null ? { seek, at: Date.now(), playing } : null;
      res.write(`event: roon\ndata: ${JSON.stringify({ status, zone })}\n\n`);
    };
    sendRoon();
    const offRoon = roon.onChange(sendRoon);
    req.on("close", () => {
      unsubscribe();
      offRoon();
    });
  };

  // Per-instance routes: /api/instances/:id/<action>
  const routes: Record<string, Handler> = {
    "GET now": (_q, _r, i) => i.now(),
    "GET capabilities": (_q, _r, i) => i.capabilities(),
    "POST change": async (q, _r, i) => i.applyChange(parseChange(await readJson(q))),
    "POST undo": (_q, _r, i) => i.undo(),
    "POST dismissjump": async (_q, _r, i) => i.dismissVolumeJump(),
    "POST transport": async (q, _r, i) => {
      const body = (await readJson(q)) as { action?: unknown };
      if (typeof body !== "object" || body === null || !TRANSPORT_ACTIONS.includes(body.action as TransportAction))
        throw new HttpError(400, `action must be one of ${TRANSPORT_ACTIONS.join(", ")}`);
      return i.transport(body.action as TransportAction);
    },
    "POST seek": async (q, _r, i) => {
      const body = (await readJson(q)) as { seconds?: unknown };
      if (
        typeof body !== "object" ||
        body === null ||
        typeof body.seconds !== "number" ||
        !Number.isFinite(body.seconds) ||
        body.seconds < 0
      )
        throw new HttpError(400, "seconds must be a number ≥ 0");
      return i.seek(body.seconds);
    },
    "GET learned": async (_q, _r, i) => i.learnedFailures(),
    "GET history": async (_q, _r, i) => i.changeHistory(),
    "DELETE learned": async (_q, _r, i) => i.forgetFailures(),
    "GET events": events,
    "GET meter": (req, res, inst) => {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(": connected\n\n");
      const off = inst.subscribeMeter((e) => res.write(`event: meter\ndata: ${JSON.stringify(e)}\n\n`));
      req.on("close", off);
    },
    "PUT roonzone": async (q, _r, i) => {
      const body = (await readJson(q)) as { zone?: unknown };
      if (
        typeof body !== "object" ||
        body === null ||
        !(body.zone === null || (typeof body.zone === "string" && body.zone.length > 0))
      )
        throw new HttpError(400, "zone must be a Roon zone id or null");
      return roon.setZone(i.cfg.id, body.zone as string | null);
    },
    "POST roonseek": async (q, _r, i) => {
      const body = (await readJson(q)) as { seconds?: unknown };
      if (
        typeof body !== "object" ||
        body === null ||
        typeof body.seconds !== "number" ||
        !Number.isFinite(body.seconds) ||
        body.seconds < 0
      )
        throw new HttpError(400, "seconds must be a number ≥ 0");
      return roon.seek(i.cfg.id, body.seconds);
    },
    "POST roontransport": async (q, _r, i) => {
      const body = (await readJson(q)) as { action?: unknown };
      if (typeof body !== "object" || body === null || !ROON_ACTIONS.includes(body.action as RoonAction))
        throw new HttpError(400, `action must be one of ${ROON_ACTIONS.join(", ")}`);
      return roon.control(i.cfg.id, body.action as RoonAction);
    },
  };

  /** An instance's current settings, by name, as preset settings. */
  async function captureFrom(instanceId: string, includeVolume: boolean): Promise<Change> {
    const inst = registry.get(instanceId);
    if (!inst) throw new HttpError(404, "unknown instance");
    const settings: Change = { ...(await inst.currentSettings()) };
    if (!includeVolume) delete settings.volume;
    // "" means no matrix profile is active: nothing to restore, so leave it out.
    if (!settings.matrixProfile) delete settings.matrixProfile;
    return settings;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = hostnameOf(req.headers.host ?? "");
    if (!allowed.has(host) && !isIpLiteral(host)) throw new HttpError(403, `host "${host}" not allowed; add it to ALLOWED_HOSTS`);
    // Writes must come from our own pages: the Origin must be the very host and
    // port the request was sent to, or a listed name on its default port (a
    // reverse proxy). Anything else, including another app on a different port
    // of this machine, is refused.
    if (req.method !== "GET" && req.headers.origin) {
      let origin: URL | null = null;
      try {
        origin = new URL(req.headers.origin);
      } catch {}
      const sameOrigin = !!origin && origin.host.toLowerCase() === (req.headers.host ?? "").toLowerCase();
      const listed = !!origin && origin.port === "" && listedHosts.has(origin.hostname.toLowerCase());
      if (!sameOrigin && !listed) throw new HttpError(403, "cross-origin request refused");
    }

    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (req.method === "GET" && path === "/api/health")
      return send(res, 200, { ok: true, version: VERSION, ...(COMMIT ? { commit: COMMIT } : {}) });
    if (path === "/api/instances") {
      if (req.method === "GET") return send(res, 200, await registry.list());
      if (req.method === "POST") return send(res, 200, await registry.add(parseNewInstance(await readJson(req))));
    }
    if (req.method === "POST" && path === "/api/discover") {
      await registry.scan();
      return send(res, 200, await registry.list());
    }
    // ---- Roon (optional) ----
    if (path === "/api/roon") {
      if (req.method === "GET") return send(res, 200, roon.view());
      if (req.method === "PUT") return send(res, 200, roon.configure(parseRoonSettings(await readJson(req))));
    }
    if (req.method === "POST" && path === "/api/roon/discover")
      return send(res, 200, opts.discovery === false ? [] : await discoverCores({ timeoutMs: 1500 }));
    const ra = /^\/api\/roon\/art\/([A-Za-z0-9_-]{1,128})$/.exec(path);
    if (ra && req.method === "GET") {
      const size = Math.min(1000, Math.max(50, Number(new URL(req.url ?? "/", "http://x").searchParams.get("size")) || 300));
      const img = await roon.image(ra[1]!, size);
      const type = /^image\/(jpeg|png)$/i.test(img.type) ? img.type : "application/octet-stream";
      res.writeHead(200, {
        "content-type": type,
        "cache-control": "max-age=86400",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "x-frame-options": "DENY",
      });
      return res.end(img.data);
    }

    // ---- presets (global) ----
    if (path === "/api/presets") {
      if (req.method === "GET") return send(res, 200, presets.list());
      if (req.method === "POST") {
        const body = parsePresetBody(await readJson(req));
        let settings = body.settings;
        if (body.fromInstance) settings = await captureFrom(body.fromInstance, body.includeVolume ?? false);
        if (!settings || Object.keys(settings).length === 0) throw new HttpError(400, "a preset needs settings or fromInstance");
        return send(res, 200, presets.create(body.name ?? "", settings, body.scope ?? undefined));
      }
    }
    const pm = /^\/api\/presets\/([^/]+)$/.exec(path);
    if (pm) {
      const id = decodeURIComponent(pm[1]!);
      if (req.method === "DELETE") {
        presets.remove(id);
        return send(res, 200, { ok: true });
      }
      if (req.method === "PATCH") {
        const body = parsePresetBody(await readJson(req), true);
        let settings = body.settings;
        if (body.fromInstance) {
          // "Update from current": replace the settings with the instance's current ones.
          settings = await captureFrom(body.fromInstance, body.includeVolume ?? presets.get(id).settings.volume !== undefined);
        }
        return send(
          res,
          200,
          presets.update(id, {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(settings ? { settings } : {}),
            ...(body.scope !== undefined ? { scope: body.scope } : {}),
          }),
        );
      }
    }
    const ipm = /^\/api\/instances\/([^/]+)\/presets(?:\/([^/]+)\/apply)?$/.exec(path);
    if (ipm) {
      const inst = registry.get(decodeURIComponent(ipm[1]!));
      if (!inst) throw new HttpError(404, "unknown instance");
      if (!ipm[2] && req.method === "GET") {
        // The shared presets, and the in-use DAC's own (dac-scope.ts).
        const list = presets.list().filter((p) => !p.scope || p.scope === inst.scope());
        const previews = await inst.previewPresets(list.map((p) => p.settings));
        return send(
          res,
          200,
          list.map((p, i) => ({ ...p, preview: previews[i] })),
        );
      }
      if (ipm[2] && req.method === "POST")
        return send(res, 200, await inst.applyPreset(presets.get(decodeURIComponent(ipm[2])).settings));
      throw new HttpError(404, "not found");
    }

    // ---- named DACs behind one HQPlayer (dac-scope.ts) ----
    const dacsRoute = /^\/api\/instances\/([^/]+)\/dacs(?:\/([^/]+))?$/.exec(path);
    if (dacsRoute) {
      const id = decodeURIComponent(dacsRoute[1]!);
      const dacId = dacsRoute[2] ? decodeURIComponent(dacsRoute[2]) : undefined;
      const body = req.method === "DELETE" ? {} : ((await readJson(req)) as Record<string, unknown>);
      if (!dacId && req.method === "POST")
        return send(res, 200, registry.addDac(id, { name: body.name, currentName: body.currentName }));
      if (dacId && req.method === "PATCH") {
        registry.renameDac(id, dacId, body.name);
        return send(res, 200, { ok: true });
      }
      if (dacId && req.method === "DELETE") {
        registry.removeDac(id, dacId);
        presets.unscope(scopeOf(id, dacId));
        return send(res, 200, { ok: true });
      }
      throw new HttpError(404, "not found");
    }
    const dacRoute = /^\/api\/instances\/([^/]+)\/dac$/.exec(path);
    if (dacRoute && req.method === "PUT") {
      const body = (await readJson(req)) as { dac?: unknown };
      if (typeof body?.dac !== "string") throw new HttpError(400, "body must be { dac }");
      registry.selectDac(decodeURIComponent(dacRoute[1]!), body.dac);
      return send(res, 200, { ok: true });
    }

    const setupRoute = /^\/api\/instances\/([^/]+)\/setup$/.exec(path);
    if (setupRoute && req.method === "PUT")
      return send(res, 200, await registry.saveSetup(decodeURIComponent(setupRoute[1]!), parseSetupChange(await readJson(req))));

    const one = /^\/api\/instances\/([^/]+)$/.exec(path);
    if (one && req.method === "PATCH") {
      const body = (await readJson(req)) as { name?: unknown };
      if (typeof body !== "object" || body === null || typeof body.name !== "string" || Object.keys(body).length !== 1)
        throw new HttpError(400, "body must be { name }");
      return send(res, 200, registry.rename(decodeURIComponent(one[1]!), body.name));
    }
    if (one && req.method === "DELETE") {
      registry.remove(decodeURIComponent(one[1]!));
      roon.forgetInstance(decodeURIComponent(one[1]!));
      return send(res, 200, { ok: true });
    }

    const m = /^\/api\/instances\/([^/]+)\/([a-z]+)$/.exec(path);
    if (!m) {
      if (req.method === "GET" && opts.staticDir && !path.startsWith("/api/") && (await serveStatic(opts.staticDir, path, res)))
        return;
      throw new HttpError(404, "not found");
    }
    const inst = registry.get(decodeURIComponent(m[1]!));
    if (!inst) throw new HttpError(404, "unknown instance");
    const route = routes[`${req.method} ${m[2]}`];
    if (!route) throw new HttpError(404, "not found");
    const out = await route(req, res, inst);
    if (out !== undefined) send(res, 200, out);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: Error) => {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) send(res, err.status, { error: err.message });
      else if (err instanceof URIError) send(res, 400, { error: "malformed URL" });
      // Failures talking to HQPlayer (network, timeouts, odd replies) are 502;
      // anything else is our bug, so say so and log it.
      else if (err instanceof PeerError) send(res, 502, { error: `instance error: ${err.message}` });
      else {
        console.error(err);
        send(res, 500, { error: "internal error" });
      }
    });
  });

  return {
    server,
    listen(port: number, host: string): Promise<string> {
      return new Promise((resolve) =>
        server.listen(port, host, () => {
          const a = server.address();
          resolve(`http://${host}:${typeof a === "object" && a ? a.port : port}`);
        }),
      );
    },
    async close() {
      registry.close();
      roon.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
