// A fake HQPlayer for development and CI. It reproduces the behaviour measured
// on 2026-10-02 (design §2.1, §2.3). Where nothing was measured it picks the
// least convenient plausible behaviour and says so in an "Inferred:" comment,
// so client code that copes with the fake should cope with the real thing.
import { createServer, type Server, type Socket } from "node:net";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { element, parseDocument, type AttrValue, type Element } from "@app/protocol";
import type { ModeLists, Profile, Remembered } from "./profile.ts";

export interface FakeOptions {
  /** Multiplies every measured delay. 1 = realistic, 0 = instant (tests). */
  timeScale?: number;
  /** Close a connection after this much idle time. Measured ≈156 s. */
  idleTimeoutMs?: number;
  /**
   * Whether a (mode, rate, shaper) combination stops playback. The default is
   * the measured case (AHM7EC8B at DSD256 or DSD512) widened to all AHM…8B
   * modulators below DSD1024. Inferred: the widening is a guess (design §4.4).
   */
  incompatible?: (c: { modeName: string; rateHz: number; shaperName: string }) => boolean;
  log?: (line: string) => void;
}

const DSD1024 = 45_158_400;

export const defaultIncompatible: NonNullable<FakeOptions["incompatible"]> = ({ modeName, rateHz, shaperName }) =>
  modeName.startsWith("SDM") && /^AHM.*8B$/.test(shaperName) && rateHz < DSD1024;

const DELAY = {
  /** First SetFilter for a filter: ~5 s (measured). */
  filterPrepare: 5000,
  /** Subsequent SetFilter: ~0.3 s (measured). */
  filterQuick: 300,
  /** SetMode: ~2.9 s (measured). */
  mode: 2900,
  /** State 3 is "seen briefly" before 0 after a bad rate change (measured; duration inferred). */
  stopRequested: 500,
  /** Inferred: resume delay once a valid rate is set again. */
  resume: 1000,
};

type Reply = string;

export class FakeHqp {
  readonly profile: Profile;
  readonly opts: Required<Omit<FakeOptions, "log">> & Pick<FakeOptions, "log">;

  modeIndex: number;
  /** Index into the current mode's rate list; 0 is auto. */
  rateIndex = 0;
  remembered = new Map<number, Remembered>();
  volume: number;
  invert: boolean;
  filter20k: boolean;
  adaptive: boolean;
  playback: 0 | 1 | 2 | 3;
  /** Playback stopped by an incompatible combination; resumes by itself once valid. */
  stalled = false;
  position = 0;
  /** Sample rate of the track being played. Set with setSource(). */
  sourceRate = 44_100;
  private prepared = new Set<string>();
  private lastTick = Date.now();
  private timers = new Set<NodeJS.Timeout>();
  /** Every request received, for tests. */
  readonly received: string[] = [];

  constructor(profile: Profile, opts: FakeOptions = {}) {
    this.profile = profile;
    this.opts = {
      timeScale: opts.timeScale ?? 1,
      idleTimeoutMs: opts.idleTimeoutMs ?? 156_000,
      incompatible: opts.incompatible ?? defaultIncompatible,
      log: opts.log,
    };
    const i = profile.initial;
    this.modeIndex = Number(i.mode);
    for (const [mv, r] of Object.entries(profile.remembered)) this.remembered.set(Number(mv), { ...r });
    this.rateIndex = Number(i.rate);
    this.volume = Number(i.volume);
    this.invert = i.invert === "1";
    this.filter20k = i.filter_20k === "1";
    this.adaptive = i.adaptive === "1";
    this.playback = Number(i.state) as 0 | 1 | 2 | 3;
  }

  /** Simulate the controlling app (e.g. Roon) switching to a track at this rate. */
  setSource(rateHz: number) {
    this.sourceRate = rateHz;
  }

  // ---- derived state -------------------------------------------------------

  get mode() {
    const m = this.profile.modes.find((x) => x.index === this.modeIndex);
    if (!m) throw new Error(`bad mode index ${this.modeIndex}`);
    return m;
  }
  get modeValue() {
    return this.mode.value;
  }
  /** Inferred: [source] mode (-1) uses the PCM lists. Not measured. */
  get lists(): ModeLists {
    const l = this.profile.lists[String(this.modeValue)] ?? this.profile.lists["0"];
    if (!l) throw new Error(`profile ${this.profile.id} has no lists for mode ${this.modeValue}`);
    return l;
  }
  get rem(): Remembered {
    let r = this.remembered.get(this.modeValue);
    if (!r) {
      // Inferred: an unvisited mode starts on the first entry of each list.
      r = { filterNx: this.lists.filters[0]?.index ?? 0, filter1x: this.lists.filters[0]?.index ?? 0, shaper: 0 };
      this.remembered.set(this.modeValue, r);
    }
    return r;
  }
  get activeRateHz(): number {
    const set = this.lists.rates[this.rateIndex] ?? 0;
    if (set !== 0) return set;
    return this.profile.activeRateWhenAuto[String(this.modeValue)] ?? Math.max(...this.lists.rates);
  }
  get shaperName() {
    return this.lists.shapers.find((s) => s.index === this.rem.shaper)?.name ?? "";
  }
  /**
   * Measured: a 44.1 kHz source uses the 1x filter and a 96 kHz source the Nx
   * filter (both instances, 2026-10-02). Inferred: 48 kHz counts as 1x, and an
   * idle instance reports 1x (matches the idle Linux capture).
   */
  get filterInUse() {
    return this.playback !== 0 && this.sourceRate > 48_000 ? this.rem.filterNx : this.rem.filter1x;
  }
  get comboBad() {
    return this.opts.incompatible({ modeName: this.mode.name, rateHz: this.activeRateHz, shaperName: this.shaperName });
  }

  private fmtVolume(v: number): string {
    // Measured: macOS "-22", Linux "-28.00000000000000000".
    return this.profile.volumeFormat === "long" ? v.toFixed(17) : String(v);
  }

  private tick() {
    const now = Date.now();
    if (this.playback === 2) this.position += (now - this.lastTick) / 1000;
    this.lastTick = now;
  }

  // ---- timing helpers -------------------------------------------------------

  private sleep(ms: number) {
    const d = ms * this.opts.timeScale;
    return d <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, d));
  }
  private later(ms: number, fn: () => void) {
    const d = ms * this.opts.timeScale;
    if (d <= 0) return fn();
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, d);
    this.timers.add(t);
  }

  /** Apply the measured stall/resume rule after anything that changes mode, rate or shaper. */
  private checkCombo() {
    if (this.comboBad && this.playback === 2) {
      this.stalled = true;
      this.playback = 3;
      this.later(DELAY.stopRequested, () => {
        if (this.playback === 3) this.playback = 0;
      });
    } else if (!this.comboBad && this.stalled) {
      this.stalled = false;
      this.later(DELAY.resume, () => {
        if (this.playback === 0 || this.playback === 3) this.playback = 2;
      });
    }
  }

  // ---- protocol -------------------------------------------------------------

  /** Handle one request document; returns the reply without the trailing newline. */
  async handle(requestXml: string): Promise<Reply> {
    this.received.push(requestXml);
    this.tick();
    let req: Element;
    try {
      req = parseDocument(requestXml);
    } catch {
      // Inferred: malformed XML is not measured. Reply with a generic error.
      return this.doc("Error", { result: "Error" }, "parse error");
    }
    const h = this.handlers[req.name];
    const out = h ? await h(req) : this.doc(req.name, { result: "Error" }, "Unknown command");
    this.opts.log?.(`${requestXml.replace(/^<\?xml[^>]*\?>/, "")} -> ${out.length > 160 ? out.slice(0, 160) + "…" : out.replace(/^<\?xml[^>]*\?>/, "")}`);
    return out;
  }

  private doc(name: string, attrs: Record<string, AttrValue> = {}, text?: string, children = ""): Reply {
    const head = '<?xml version="1.0" encoding="utf-8"?>';
    if (children) {
      const open = element(name, attrs).replace(/\/>$/, ">");
      return `${head}${open}${children}</${name}>`;
    }
    return head + element(name, attrs, text);
  }
  private ok(name: string, extra: Record<string, AttrValue> = {}) {
    return this.doc(name, { result: "OK", ...extra });
  }

  private intArg(req: Element, key = "value"): number | null {
    const v = req.attrs[key];
    if (v === undefined || !/^\d+$/.test(v)) return null;
    return Number(v);
  }

  private handlers: Record<string, (req: Element) => Reply | Promise<Reply>> = {
    GetInfo: () => this.doc("GetInfo", { ...this.profile.info }),

    State: () =>
      this.doc("State", {
        active_mode: this.modeValue,
        active_rate: this.activeRateHz,
        adaptive: this.adaptive,
        convolution: 0,
        filter: this.filterInUse,
        filter1x: this.rem.filter1x,
        filterNx: this.rem.filterNx,
        filter_20k: this.filter20k,
        invert: this.invert,
        matrix_profile: "",
        mode: this.modeIndex,
        random: 0,
        rate: this.rateIndex,
        repeat: 0,
        shaper: this.rem.shaper,
        state: this.playback,
        volume: this.fmtVolume(this.volume),
      }),

    Status: () => {
      const f = this.lists.filters.find((x) => x.index === this.filterInUse);
      const pos = this.profile.volumeFormat === "long" ? this.position.toFixed(17) : String(this.position);
      const playing = this.playback !== 0 || this.stalled;
      // Real replies carry a <metadata> child while playing (measured); its stream URI is omitted here.
      const meta = playing
        ? element("metadata", { bits: 24, channels: 2, samplerate: this.sourceRate, sdm: 0, song: "Fake track" })
        : "";
      return this.doc("Status", {
        active_bits: this.modeValue === 1 ? 1 : 32,
        active_channels: 2,
        active_filter: f?.name ?? "",
        active_mode: this.mode.name,
        active_rate: this.activeRateHz,
        active_shaper: this.shaperName,
        clips: 0,
        filter_20k: this.filter20k,
        position: pos,
        state: this.playback,
        track: playing ? 1 : 0,
        tracks_total: playing ? 1 : 0,
        volume: this.fmtVolume(this.volume),
      }, undefined, meta);
    },

    GetModes: () =>
      this.doc("GetModes", {}, undefined, this.profile.modes.map((m) => element("ModesItem", { ...m })).join("")),
    GetFilters: () =>
      this.doc(
        "GetFilters",
        {},
        undefined,
        this.lists.filters.map((f) => element("FiltersItem", { arg: f.arg, index: f.index, name: f.name, value: f.value })).join(""),
      ),
    GetShapers: () =>
      this.doc("GetShapers", {}, undefined, this.lists.shapers.map((s) => element("ShapersItem", { ...s })).join("")),
    GetRates: () =>
      this.doc("GetRates", {}, undefined, this.lists.rates.map((rate, index) => element("RatesItem", { index, rate })).join("")),
    VolumeRange: () => {
      const r = this.profile.volumeRange;
      return this.doc("VolumeRange", {
        adaptive: r.adaptive,
        enabled: r.enabled,
        max: this.fmtVolume(r.max),
        min: this.fmtVolume(r.min),
      });
    },

    ConfigurationList: () =>
      this.profile.configurations === null
        ? this.doc("ConfigurationList", { result: "Error" }, this.profile.configurationListError ?? "path doesn't exist")
        : this.doc(
            "ConfigurationList",
            { active: "", result: "OK" },
            undefined,
            this.profile.configurations.map((name) => element("ConfigurationItem", { name })).join(""),
          ),
    // Measured: blocked by SessionAuthentication (design §2.4). Never emulate success.
    ConfigurationLoad: () => this.doc("ConfigurationLoad", { result: "Error" }, "missing data or not authorized"),
    ConfigurationGet: () => this.ok("ConfigurationGet", { value: "" }),
    MatrixListProfiles: () => this.ok("MatrixListProfiles"),
    GetInputs: () => this.doc("GetInputs", { result: "OK" }, undefined, element("InputsItem", { name: "cd:" })),

    SetMode: async (req) => {
      const i = this.intArg(req);
      // Inferred: an out-of-range index replies OK and changes nothing. Not measured;
      // chosen because it punishes clients that trust OK.
      if (i === null || !this.profile.modes.some((m) => m.index === i)) return this.ok("SetMode");
      await this.sleep(DELAY.mode);
      this.tick();
      this.modeIndex = i;
      // Reported by HQPTuner (Embedded 6.0.4): a mode switch clears the rate pin.
      // Unmeasured on Desktop. Modelled as a reset to auto.
      this.rateIndex = 0;
      this.checkCombo();
      return this.ok("SetMode");
    },

    SetRate: (req) => {
      const i = this.intArg(req);
      if (i !== null && i < this.lists.rates.length) {
        this.rateIndex = i;
        this.checkCombo();
      }
      // Measured: OK even when the combination then stops playback.
      return this.ok("SetRate");
    },

    SetFilter: async (req) => {
      const nx = this.intArg(req);
      const x1 = this.intArg(req, "value1x");
      const valid = (i: number | null) => i !== null && this.lists.filters.some((f) => f.index === i);
      if (!valid(nx)) return this.ok("SetFilter");
      const key = `${this.modeValue}:${nx}`;
      await this.sleep(this.prepared.has(key) ? DELAY.filterQuick : DELAY.filterPrepare);
      this.prepared.add(key);
      this.rem.filterNx = nx!;
      if (valid(x1)) this.rem.filter1x = x1!;
      return this.ok("SetFilter");
    },

    SetShaping: (req) => {
      const i = this.intArg(req);
      if (i !== null && this.lists.shapers.some((s) => s.index === i)) {
        this.rem.shaper = i;
        // Inferred: a bad shaper for the current rate stalls just like a bad rate.
        this.checkCombo();
      }
      return this.ok("SetShaping");
    },

    SetInvert: (req) => {
      this.invert = req.attrs.value === "1";
      return this.ok("SetInvert");
    },
    // Measured: these two reply with no result attribute at all.
    Set20kFilter: (req) => {
      this.filter20k = req.attrs.value === "1";
      return this.doc("Set20kFilter");
    },
    SetAdaptiveVolume: (req) => {
      this.adaptive = req.attrs.value === "1";
      return this.doc("SetAdaptiveVolume");
    },
    // Measured: with no convolution filters configured, OK + value="0" and nothing changes.
    SetConvolution: () => this.ok("SetConvolution", { value: 0 }),

    Volume: (req) => {
      const v = Number(req.attrs.value);
      if (Number.isFinite(v)) {
        // Inferred: clamped to VolumeRange. Not measured.
        const { min, max } = this.profile.volumeRange;
        this.volume = Math.min(max, Math.max(min, v));
      }
      return this.ok("Volume");
    },

    // Measured: nothing restarts a stalled instance except fixing the rate.
    Play: () => {
      if (!this.stalled && !this.comboBad) this.playback = 2;
      return this.ok("Play");
    },
    Pause: () => {
      if (this.playback === 2) this.playback = 1;
      return this.ok("Pause");
    },
    Stop: () => {
      // Inferred: an explicit Stop clears the auto-resume.
      this.stalled = false;
      this.playback = 0;
      this.position = 0;
      return this.ok("Stop");
    },
  };

  // ---- network --------------------------------------------------------------

  private server?: Server;
  private udp?: UdpSocket;
  private sockets = new Set<Socket>();

  /** The bound TCP port, once listening. */
  get port(): number {
    const a = this.server?.address();
    if (!a || typeof a !== "object") throw new Error("not listening");
    return a.port;
  }

  /** Listen for TCP control connections. Defaults to loopback on an ephemeral port. */
  listen(port = 0, host = "127.0.0.1"): Promise<{ host: string; port: number }> {
    const server = createServer((sock) => this.serve(sock));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        const a = server.address();
        resolve({ host, port: typeof a === "object" && a ? a.port : port });
      });
    });
  }

  private serve(sock: Socket) {
    this.sockets.add(sock);
    sock.setEncoding("utf8");
    sock.setTimeout(this.opts.idleTimeoutMs, () => sock.destroy());
    sock.on("close", () => this.sockets.delete(sock));
    sock.on("error", () => sock.destroy());
    let buf = "";
    let chain = Promise.resolve();
    sock.on("data", (d: string) => {
      buf += d;
      let nl: number;
      // Inferred: requests are framed by newline, as clients send them. Several per
      // connection are allowed and answered in order.
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        chain = chain.then(async () => {
          const reply = await this.handle(line);
          if (!sock.destroyed) sock.write(reply + "\n");
        });
      }
    });
  }

  /**
   * Answer `<discover>hqplayer</discover>` on UDP. Off by default: on a machine that
   * runs a real HQPlayer, joining its multicast group would make the fake discoverable
   * next to it. Reply shape measured.
   */
  listenDiscovery(port: number, group = "239.192.0.199"): Promise<void> {
    const udp = createSocket({ type: "udp4", reuseAddr: true });
    this.udp = udp;
    udp.on("message", (msg, rinfo) => {
      if (!msg.toString().includes("<discover>hqplayer</discover>")) return;
      const reply = this.doc(
        "discover",
        { name: this.profile.info.name, result: "OK", version: this.profile.discover.version },
        "hqplayer",
      );
      udp.send(reply, rinfo.port, rinfo.address);
    });
    return new Promise((resolve) =>
      udp.bind(port, () => {
        try {
          udp.addMembership(group);
        } catch {
          // Loopback-only setups may not support multicast; unicast still works.
        }
        resolve();
      }),
    );
  }

  async close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const s of this.sockets) s.destroy();
    this.udp?.close();
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
  }
}
