// HTTP API on node:http, no framework.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import type { AppConfig } from "./config.ts";
import { HttpError, Instance, TRANSPORT_ACTIONS, type Change, type TransportAction } from "./instance.ts";
import { LearnedStore } from "./learned.ts";
import { serveStatic } from "./static.ts";
import { Registry } from "./registry.ts";
import { PresetStore } from "./presets.ts";
import type { DiscoverOptions, LibraryAlbum } from "@app/protocol";
import type { WatchTiming } from "./watch.ts";

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
  /** Playback-check timing; tests shorten it. */
  timing?: { quick: WatchTiming; major: WatchTiming };
  /** Live playback-speed window (default 8 s). */
  speedWindowMs?: number;
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
      kind === "name" ? typeof v === "string" && v.length > 0
      : kind === "number" ? typeof v === "number" && Number.isFinite(v)
      : kind === "rate" ? Number.isInteger(v) && (v as number) >= 0
      : typeof v === "boolean";
    const want = { name: "a non-empty string", number: "a number", rate: "a whole number of Hz (0 = auto)", boolean: "a boolean" }[kind];
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
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
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

/** Album summaries (no tracks), filtered by ?q= across the text fields, paged. */
function searchAlbums(albums: LibraryAlbum[], params: URLSearchParams) {
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  const text = (a: LibraryAlbum) =>
    [a.album, a.artist, a.composer, a.performer, a.genre, a.date].filter(Boolean).join(" ").toLowerCase();
  const hits = words.length ? albums.filter((a) => words.every((w) => text(a).includes(w))) : albums;
  const sorted = [...hits].sort(
    (x, y) => (x.artist ?? "").localeCompare(y.artist ?? "") || x.album.localeCompare(y.album),
  );
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? 100) || 100));
  return {
    total: sorted.length,
    offset,
    albums: sorted.slice(offset, offset + limit).map(({ tracks, path: _p, ...a }) => ({ ...a, trackCount: tracks.length })),
  };
}

function parsePresetBody(
  body: unknown,
  patch = false,
): { name?: string; settings?: Change; fromInstance?: string; includeVolume?: boolean } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  const { name, settings, fromInstance, includeVolume, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new HttpError(400, `unknown field "${Object.keys(rest)[0]}"`);
  if (name !== undefined && typeof name !== "string") throw new HttpError(400, "name must be a string");
  if (!patch && name === undefined) throw new HttpError(400, "name is required");
  if (fromInstance !== undefined && typeof fromInstance !== "string") throw new HttpError(400, "fromInstance must be an instance id");
  if (includeVolume !== undefined && typeof includeVolume !== "boolean") throw new HttpError(400, "includeVolume must be a boolean");
  return {
    ...(name !== undefined ? { name: name as string } : {}),
    ...(settings !== undefined ? { settings: parseChange(settings) } : {}),
    ...(fromInstance !== undefined ? { fromInstance: fromInstance as string } : {}),
    ...(includeVolume !== undefined ? { includeVolume: includeVolume as boolean } : {}),
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
  const presets = opts.presets ?? new PresetStore(null);
  const registry = new Registry(config, {
    configDir: opts.configDir ?? null,
    discovery: opts.discovery ?? false,
    ...(opts.discoveredPort ? { discoveredPort: opts.discoveredPort } : {}),
    makeInstance: (cfg) =>
      new Instance(cfg, {
        learned,
        ...(opts.timing ? { timing: opts.timing } : {}),
        ...(opts.speedWindowMs ? { speedWindowMs: opts.speedWindowMs } : {}),
      }),
  });
  const allowed = new Set([...LOOPBACK, ...(opts.allowedHosts ?? []).map((h) => h.toLowerCase())]);

  const events: Handler = (req, res, inst) => {
    res.writeHead(200, {
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
    req.on("close", unsubscribe);
  };

  // Per-instance routes: /api/instances/:id/<action>
  const routes: Record<string, Handler> = {
    "GET now": (_q, _r, i) => i.now(),
    "GET capabilities": (_q, _r, i) => i.capabilities(),
    "POST change": async (q, _r, i) => i.applyChange(parseChange(await readJson(q))),
    "POST undo": (_q, _r, i) => i.undo(),
    "POST transport": async (q, _r, i) => {
      const body = (await readJson(q)) as { action?: unknown };
      if (typeof body !== "object" || body === null || !TRANSPORT_ACTIONS.includes(body.action as TransportAction))
        throw new HttpError(400, `action must be one of ${TRANSPORT_ACTIONS.join(", ")}`);
      return i.transport(body.action as TransportAction);
    },
    "GET learned": async (_q, _r, i) => i.learnedFailures(),
    "DELETE learned": async (_q, _r, i) => i.forgetFailures(),
    "GET events": events,
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
    if (!allowed.has(host) && !isIpLiteral(host))
      throw new HttpError(403, `host "${host}" not allowed; add it to ALLOWED_HOSTS`);
    // Writes must come from our own pages: the Origin must be the very host the
    // request was sent to (or a listed name). A page served from any other
    // address, IP or not, is refused.
    if (req.method !== "GET" && req.headers.origin) {
      let originHost = "";
      try {
        originHost = new URL(req.headers.origin).host.toLowerCase();
      } catch {}
      const sameOrigin = originHost !== "" && originHost === (req.headers.host ?? "").toLowerCase();
      const listed = allowed.has(hostnameOf(originHost));
      if (!sameOrigin && !listed) throw new HttpError(403, "cross-origin request refused");
    }

    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true });
    if (path === "/api/instances") {
      if (req.method === "GET") return send(res, 200, await registry.list());
      if (req.method === "POST") return send(res, 200, registry.add(parseNewInstance(await readJson(req))));
    }
    if (req.method === "POST" && path === "/api/discover") {
      await registry.scan();
      return send(res, 200, await registry.list());
    }
    // ---- presets (global) ----
    if (path === "/api/presets") {
      if (req.method === "GET") return send(res, 200, presets.list());
      if (req.method === "POST") {
        const body = parsePresetBody(await readJson(req));
        let settings = body.settings;
        if (body.fromInstance) settings = await captureFrom(body.fromInstance, body.includeVolume ?? false);
        if (!settings || Object.keys(settings).length === 0) throw new HttpError(400, "a preset needs settings or fromInstance");
        return send(res, 200, presets.create(body.name ?? "", settings));
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
        return send(res, 200, presets.update(id, { ...(body.name !== undefined ? { name: body.name } : {}), ...(settings ? { settings } : {}) }));
      }
    }
    const ipm = /^\/api\/instances\/([^/]+)\/presets(?:\/([^/]+)\/apply)?$/.exec(path);
    if (ipm) {
      const inst = registry.get(decodeURIComponent(ipm[1]!));
      if (!inst) throw new HttpError(404, "unknown instance");
      if (!ipm[2] && req.method === "GET") {
        const list = presets.list();
        const previews = await inst.previewPresets(list.map((p) => p.settings));
        return send(res, 200, list.map((p, i) => ({ ...p, preview: previews[i] })));
      }
      if (ipm[2] && req.method === "POST") return send(res, 200, await inst.applyPreset(presets.get(decodeURIComponent(ipm[2])).settings));
      throw new HttpError(404, "not found");
    }

    // ---- HQPlayer library ----
    const lm = /^\/api\/instances\/([^/]+)\/library(?:\/(albums|art)\/([^/]+)|\/(play))?$/.exec(path);
    if (lm) {
      const inst = registry.get(decodeURIComponent(lm[1]!));
      if (!inst) throw new HttpError(404, "unknown instance");
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && !lm[2] && !lm[4]) {
        const lib = await inst.library(url.searchParams.get("refresh") === "1");
        return send(res, 200, searchAlbums(lib.albums, url.searchParams));
      }
      if (req.method === "GET" && lm[2] === "albums") {
        const album = (await inst.library()).byHash.get(decodeURIComponent(lm[3]!));
        if (!album) throw new HttpError(404, "unknown album");
        return send(res, 200, album);
      }
      if (req.method === "GET" && lm[2] === "art") {
        const pic = await inst.picture(decodeURIComponent(lm[3]!));
        if (!pic) throw new HttpError(404, "no cover art");
        // HQPlayer's type string may come from a music file's tags: only ever serve
        // it as an image, never sniffed, never as a document that can run script.
        const type = /^image\/(jpeg|png|gif|webp|bmp)$/i.test(pic.type) ? pic.type : "application/octet-stream";
        res.writeHead(200, {
          "content-type": type,
          "cache-control": "max-age=86400",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'",
        });
        return res.end(pic.data);
      }
      if (req.method === "POST" && lm[4] === "play") {
        const body = (await readJson(req)) as { album?: unknown; track?: unknown };
        if (typeof body?.album !== "string") throw new HttpError(400, "album (hash) is required");
        if (body.track !== undefined && !Number.isInteger(body.track)) throw new HttpError(400, "track must be a whole number");
        return send(res, 200, await inst.playAlbum(body.album, (body.track as number | undefined) ?? 0));
      }
      throw new HttpError(404, "not found");
    }

    const one = /^\/api\/instances\/([^/]+)$/.exec(path);
    if (one && req.method === "DELETE") {
      registry.remove(decodeURIComponent(one[1]!));
      return send(res, 200, { ok: true });
    }

    const m = /^\/api\/instances\/([^/]+)\/([a-z]+)$/.exec(path);
    if (!m) {
      if (req.method === "GET" && opts.staticDir && !path.startsWith("/api/") && (await serveStatic(opts.staticDir, path, res))) return;
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
      // Anything else is a failure talking to the instance.
      else send(res, 502, { error: `instance error: ${err.message}` });
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
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
