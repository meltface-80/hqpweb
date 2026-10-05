// Instance registry: configured instances (instances.json, editable in Settings)
// merged with instances found by discovery, deduplicated, each with a health
// check. Discovered-only instances are usable without saving them.
import { lookup } from "node:dns/promises";
import { HqpClient, discover, type DiscoverOptions, type Discovered } from "@app/protocol";
import { HttpError, Instance } from "./instance.ts";
import { ID_PATTERN, saveConfig, type AppConfig, type InstanceConfig, type InstanceSetup } from "./config.ts";
import { applySetupChange, type SetupChange } from "./setup.ts";

export interface InstanceView {
  id: string;
  name: string;
  host: string;
  port: number;
  /** configured = in instances.json; discovered = found on the network only. */
  source: "configured" | "discovered";
  /** Seen by discovery recently. Instances on other VLANs never are; that's normal. */
  discovered: boolean;
  /** Answers on its control port. null until first checked. */
  reachable: boolean | null;
  error?: string;
  product?: string;
  engine?: string;
  /** The listener's setup answers; only configured instances have them. */
  setup?: InstanceSetup;
}

interface Health {
  at: number;
  reachable: boolean;
  error?: string;
  product?: string;
  engine?: string;
  hqpName?: string;
}

export interface RegistryOptions {
  /** Where instances.json lives; null = in memory only (tests). */
  configDir: string | null;
  makeInstance: (cfg: InstanceConfig) => Instance;
  /** false disables discovery. */
  discovery?: DiscoverOptions | false;
  scanEveryMs?: number;
  healthTtlMs?: number;
  healthTimeoutMs?: number;
  /** Control port assumed for discovered instances (replies don't carry one). Tests override it. */
  discoveredPort?: number;
}

const DISCOVERED_TTL_MS = 180_000;
/** A LAN has a handful of HQPlayers; spoofed replies mustn't grow this without bound. */
const MAX_DISCOVERED = 32;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "instance";
const discoveredId = (address: string) => `d-${address.replace(/[^a-z0-9]+/gi, "-")}`;

export class Registry {
  private config: AppConfig;
  private readonly opts: Required<Omit<RegistryOptions, "discovery">> & { discovery: DiscoverOptions | false };
  private live = new Map<string, Instance>();
  private seen = new Map<string, { d: Discovered; at: number }>();
  private health = new Map<string, Health>();
  private checking = new Map<string, Promise<Health>>();
  private resolved = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private scanning: Promise<void> | null = null;

  constructor(config: AppConfig, opts: RegistryOptions) {
    this.config = structuredClone(config);
    this.opts = {
      scanEveryMs: 60_000,
      healthTtlMs: 10_000,
      healthTimeoutMs: 2500,
      discoveredPort: 4321,
      ...opts,
      discovery: opts.discovery ?? {},
    };
    if (this.opts.discovery !== false) {
      void this.scan();
      this.timer = setInterval(() => void this.scan(), this.opts.scanEveryMs);
      this.timer.unref();
    }
  }

  // ---- discovery ------------------------------------------------------------

  scan(): Promise<void> {
    if (this.opts.discovery === false) return Promise.resolve();
    this.scanning ??= discover(this.opts.discovery)
      .then((found) => {
        const now = Date.now();
        for (const d of found)
          if (this.seen.has(d.address) || this.seen.size < MAX_DISCOVERED) this.seen.set(d.address, { d, at: now });
        for (const [a, s] of this.seen) {
          if (now - s.at <= DISCOVERED_TTL_MS) continue;
          this.seen.delete(a);
          // Gone from the network: close its connection too.
          const id = discoveredId(a);
          if (!this.config.instances.some((c) => c.id === id)) {
            this.live.get(id)?.close();
            this.live.delete(id);
            this.health.delete(id);
          }
        }
      })
      .catch(() => undefined)
      .finally(() => (this.scanning = null));
    return this.scanning;
  }

  /** Which configured instance (if any) a discovered one duplicates: same IP, or same HQPlayer name. */
  private duplicateOf(d: Discovered): InstanceConfig | undefined {
    return this.config.instances.find(
      (c) =>
        c.host === d.address ||
        this.resolved.get(c.host) === d.address ||
        (d.name !== "" && this.health.get(c.id)?.hqpName === d.name),
    );
  }

  private async resolveHosts() {
    await Promise.all(
      this.config.instances.map(async (c) => {
        if (this.resolved.has(c.host)) return;
        try {
          this.resolved.set(c.host, (await lookup(c.host, { family: 4 })).address);
        } catch {
          this.resolved.set(c.host, "");
        }
      }),
    );
  }

  private discoveredOnly(): InstanceConfig[] {
    return [...this.seen.values()]
      .filter(({ d }) => !this.duplicateOf(d))
      .map(({ d }) => ({
        id: discoveredId(d.address),
        name: d.name || d.address,
        host: d.address,
        port: this.opts.discoveredPort,
      }));
  }

  // ---- lookup -----------------------------------------------------------------

  private configFor(id: string): { cfg: InstanceConfig; source: InstanceView["source"] } | undefined {
    const c = this.config.instances.find((i) => i.id === id);
    if (c) return { cfg: c, source: "configured" };
    const d = this.discoveredOnly().find((i) => i.id === id);
    return d ? { cfg: d, source: "discovered" } : undefined;
  }

  get(id: string): Instance | undefined {
    const found = this.configFor(id);
    if (!found) return undefined;
    let inst = this.live.get(id);
    const { cfg } = found;
    if (inst && (inst.cfg.host !== cfg.host || inst.cfg.port !== cfg.port)) {
      inst.close();
      inst = undefined;
    }
    if (!inst) {
      inst = this.opts.makeInstance(cfg);
      this.live.set(id, inst);
    }
    return inst;
  }

  // ---- health -----------------------------------------------------------------

  private check(cfg: InstanceConfig): Promise<Health> {
    const cached = this.health.get(cfg.id);
    if (cached && Date.now() - cached.at < this.opts.healthTtlMs) return Promise.resolve(cached);
    let p = this.checking.get(cfg.id);
    if (!p) {
      const inst = this.get(cfg.id);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("no answer")), this.opts.healthTimeoutMs).unref(),
      );
      p = (
        inst
          ? Promise.race([inst.client.info(), timeout]).catch((e: Error) => {
              // Don't leave a silent peer's connection reading in the background.
              if (e.message === "no answer") inst.client.close();
              throw e;
            })
          : Promise.reject(new Error("unknown"))
      )
        .then(
          (info): Health => ({ at: Date.now(), reachable: true, product: info.product, engine: info.engine, hqpName: info.name }),
          (e: Error): Health => ({ at: Date.now(), reachable: false, error: e.message }),
        )
        .then((h) => {
          this.health.set(cfg.id, h);
          this.checking.delete(cfg.id);
          return h;
        });
      this.checking.set(cfg.id, p);
    }
    return p;
  }

  async list(): Promise<InstanceView[]> {
    await this.resolveHosts();
    // Health first: dedupe by name needs each configured instance's HQPlayer name.
    const configured = await Promise.all(this.config.instances.map(async (c) => ({ c, h: await this.check(c) })));
    const discoveredAddrs = new Set(this.seen.keys());
    const seenNames = new Set([...this.seen.values()].map((s) => s.d.name).filter(Boolean));
    const views: InstanceView[] = configured.map(({ c, h }) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      port: c.port,
      source: "configured",
      discovered:
        discoveredAddrs.has(c.host) ||
        discoveredAddrs.has(this.resolved.get(c.host) ?? "") ||
        (!!h.hqpName && seenNames.has(h.hqpName)),
      reachable: h.reachable,
      ...(h.error ? { error: h.error } : {}),
      ...(h.product ? { product: h.product, engine: h.engine } : {}),
      ...(c.setup ? { setup: c.setup } : {}),
    }));
    const discovered = this.discoveredOnly();
    const checks = await Promise.all(discovered.map((d) => this.check(d)));
    for (const [i, d] of discovered.entries()) {
      const h = checks[i]!;
      views.push({
        ...d,
        source: "discovered",
        discovered: true,
        reachable: h.reachable,
        ...(h.error ? { error: h.error } : {}),
        ...(h.product ? { product: h.product, engine: h.engine } : {}),
      });
    }
    return views;
  }

  // ---- edits (Settings) ---------------------------------------------------------

  /**
   * Adds an instance. A blank name becomes the name HQPlayer reports for itself
   * (GetInfo), or the host if it doesn't answer within 3 s.
   */
  async add(input: { name: string; host: string; port?: number; id?: string }): Promise<InstanceConfig> {
    let name = input.name.trim();
    const host = input.host.trim();
    const port = input.port ?? 4321;
    if (!name && /^[A-Za-z0-9.\-:[\]]{1,253}$/.test(host)) {
      const probe = new HqpClient(host, { port, timeoutMs: 3000 });
      try {
        name = (await probe.info()).name.trim().slice(0, 64);
      } catch {
      } finally {
        probe.close();
      }
      name ||= host.slice(0, 64);
    }
    if (!name || name.length > 64) throw new HttpError(400, "name must be 1–64 characters");
    if (!/^[A-Za-z0-9.\-:[\]]{1,253}$/.test(host)) throw new HttpError(400, "host must be a hostname or IP address");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, "port must be 1–65535");
    if (this.config.instances.some((i) => i.host === host && i.port === port))
      throw new HttpError(409, `${host}:${port} is already configured`);
    let id = input.id && ID_PATTERN.test(input.id) ? input.id : slug(name);
    for (let n = 2; this.config.instances.some((i) => i.id === id); n++) id = `${slug(name)}-${n}`;
    const cfg: InstanceConfig = { id, name, host, port };
    this.config.instances.push(cfg);
    this.persist();
    return cfg;
  }

  /** Renames a configured instance; its id (and so its Roon zone and learned failures) stays. */
  rename(id: string, name: string): InstanceConfig {
    const cfg = this.config.instances.find((i) => i.id === id);
    if (!cfg) throw new HttpError(404, "not a configured instance");
    const n = name.trim();
    if (!n || n.length > 64) throw new HttpError(400, "name must be 1–64 characters");
    cfg.name = n;
    this.persist();
    return cfg;
  }

  /**
   * Changes an instance's setup answers. Answers belong to a saved instance, so a
   * discovered-only one is saved first, under the id it already has (so the app's
   * selection, Roon zone and learned failures stay with it); `savedNow` says so.
   */
  async saveSetup(id: string, change: SetupChange): Promise<{ instance: InstanceConfig; savedNow: boolean }> {
    let cfg = this.config.instances.find((i) => i.id === id);
    const savedNow = !cfg;
    if (!cfg) {
      const d = this.discoveredOnly().find((i) => i.id === id);
      if (!d) throw new HttpError(404, "no such instance");
      cfg = await this.add({ name: d.name, host: d.host, port: d.port, id: d.id });
    }
    const setup = applySetupChange(cfg.setup, change);
    if (setup) cfg.setup = setup;
    else delete cfg.setup;
    this.persist();
    return { instance: cfg, savedNow };
  }

  remove(id: string) {
    const before = this.config.instances.length;
    this.config.instances = this.config.instances.filter((i) => i.id !== id);
    if (this.config.instances.length === before) throw new HttpError(404, "not a configured instance");
    this.live.get(id)?.close();
    this.live.delete(id);
    this.health.delete(id);
    this.persist();
  }

  private persist() {
    if (this.opts.configDir) saveConfig(this.opts.configDir, this.config);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    for (const i of this.live.values()) i.close();
    this.live.clear();
  }
}
