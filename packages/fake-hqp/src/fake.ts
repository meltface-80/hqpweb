// A fake HQPlayer for development and CI. It reproduces the behaviour measured
// on 2026-10-02 (design §2.1, §2.3). Where nothing was measured it picks the
// least convenient plausible behaviour and says so in an "Inferred:" comment,
// so client code that copes with the fake should cope with the real thing.
import { createServer, type Server, type Socket } from "node:net";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { element, filterSlot, parseDocument, predictedStop, type AttrValue, type Element } from "@app/protocol";
import type { ModeLists, Profile, Remembered } from "./profile.ts";

export interface FakeOptions {
  /** Multiplies every measured delay. 1 = realistic, 0 = instant (tests). */
  timeScale?: number;
  /** Close a connection after this much idle time. Measured ≈156 s. */
  idleTimeoutMs?: number;
  /**
   * Whether the settings in use stop playback. Default: defaultIncompatible.
   */
  incompatible?: (c: { modeName: string; rateHz: number; shaperName: string; filterName: string; sourceRate: number }) => boolean;
  /**
   * Simulated CPU/GPU load: playback speed (1 = real time) for the settings in
   * use. Default: never overloaded. Inferred model: an overloaded instance keeps
   * state 2 but its position falls behind real time. Not yet measured.
   */
  speed?: (c: { modeName: string; rateHz: number; filterName: string; shaperName: string }) => number;
  /** Matrix profiles configured in HQPlayer. Measured on both instances: none. */
  matrixProfiles?: string[];
  /** Whether convolution impulse responses are configured. Measured: not, on both. */
  convolutionConfigured?: boolean;
  log?: (line: string) => void;
}

/**
 * Default: what the manual's rules predict (integer-ratio filters, the AHM
 * modulator floor; see @app/protocol compat.ts). The AHM floor is also measured.
 */
export const defaultIncompatible: NonNullable<FakeOptions["incompatible"]> = (c) =>
  predictedStop({
    mode: c.modeName,
    filter: c.filterName,
    shaper: c.shaperName,
    sourceRate: c.sourceRate,
    outputRate: c.rateHz,
  }) !== undefined;

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
  /** The first request on a new connection: 265 ms locally, 606 ms across VLANs (measured). */
  firstRequest: 265,
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
  convolution = false;
  matrixProfile = "";
  /** HQPlayer's own playlist (PlaylistAdd), and the selected entry. */
  playlist: string[] = [];
  playlistIndex = 0;
  /** What feeds HQPlayer: "Roon" for a Roon stream (measured metadata), else the playlist. */
  feeder: "Roon" | "playlist" = "Roon";
  /** Sample rate of the track being played. Set with setSource(). */
  sourceRate = 44_100;
  private prepared = new Set<string>();
  private lastTick = Date.now();
  private timers = new Set<NodeJS.Timeout>();
  /**
   * Fault injection: commands named here reply OK and change nothing, which is how
   * a no-op looks on the real thing (design §2.1). For testing read-back checks.
   */
  readonly ignore = new Set<string>();
  /** Every request received, for tests. */
  readonly received: string[] = [];

  constructor(profile: Profile, opts: FakeOptions = {}) {
    this.profile = profile;
    this.opts = {
      timeScale: opts.timeScale ?? 1,
      idleTimeoutMs: opts.idleTimeoutMs ?? 156_000,
      incompatible: opts.incompatible ?? defaultIncompatible,
      speed: opts.speed ?? (() => 1),
      matrixProfiles: opts.matrixProfiles ?? [],
      convolutionConfigured: opts.convolutionConfigured ?? false,
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
   * 1x below 50 kHz source, Nx above (manual §4.6; measured at 44.1k and 96k).
   * Inferred: an idle instance reports 1x (matches the idle Linux capture).
   */
  get filterInUse() {
    const active = this.playback !== 0 || this.stalled;
    return active && filterSlot(this.sourceRate) === "Nx" ? this.rem.filterNx : this.rem.filter1x;
  }
  get comboBad() {
    const filterName = this.lists.filters.find((f) => f.index === this.filterInUse)?.name ?? "";
    return this.opts.incompatible({
      modeName: this.mode.name,
      rateHz: this.activeRateHz,
      shaperName: this.shaperName,
      filterName,
      sourceRate: this.sourceRate,
    });
  }

  private fmtVolume(v: number): string {
    // Measured: macOS "-22", Linux "-28.00000000000000000".
    return this.profile.volumeFormat === "long" ? v.toFixed(17) : String(v);
  }

  /** The simulated machine's speed for the current settings (1 = real time). */
  private currentSpeed(): number {
    const f = this.lists.filters.find((x) => x.index === this.filterInUse)?.name ?? "";
    return this.opts.speed({ modeName: this.mode.name, rateHz: this.activeRateHz, filterName: f, shaperName: this.shaperName });
  }

  private tick() {
    const now = Date.now();
    if (this.playback === 2) this.position += ((now - this.lastTick) / 1000) * this.currentSpeed();
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
    if (this.ignore.has(req.name)) return this.ok(req.name);
    const h = this.handlers[req.name];
    const out = h ? await h(req) : this.doc(req.name, { result: "Error" }, "Unknown command");
    this.opts.log?.(
      `${requestXml.replace(/^<\?xml[^>]*\?>/, "")} -> ${out.length > 160 ? out.slice(0, 160) + "…" : out.replace(/^<\?xml[^>]*\?>/, "")}`,
    );
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
        convolution: this.convolution,
        filter: this.filterInUse,
        filter1x: this.rem.filter1x,
        filterNx: this.rem.filterNx,
        filter_20k: this.filter20k,
        invert: this.invert,
        matrix_profile: this.matrixProfile,
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
      // Real HQPlayer moves position in ~1 s steps (measured); report it that way
      // unless time runs faster than real (time-scale tests).
      const p = this.opts.timeScale >= 1 ? Math.floor(this.position) : this.position;
      const pos = this.profile.volumeFormat === "long" ? p.toFixed(17) : String(p);
      const playing = this.playback !== 0 || this.stalled;
      // Real replies carry a <metadata> child while playing (measured); its stream URI is omitted here.
      const song = this.feeder === "Roon" ? "Roon" : ((this.playlist[this.playlistIndex] ?? "").split("/").pop() ?? "");
      const meta = playing ? element("metadata", { bits: 24, channels: 2, samplerate: this.sourceRate, sdm: 0, song }) : "";
      return this.doc(
        "Status",
        {
          active_bits: this.modeValue === 1 ? 1 : 32,
          active_channels: 2,
          active_filter: f?.name ?? "",
          active_mode: this.mode.name,
          active_rate: this.activeRateHz,
          active_shaper: this.shaperName,
          clips: 0,
          filter_20k: this.filter20k,
          // Real replies: the track length for files, 0 for a Roon stream (measured).
          length: playing && this.feeder !== "Roon" ? 300 : 0,
          position: pos,
          // Measured (5.17.2, 6.2.3): processing speed as a multiple of real time, 0
          // when not playing. Healthy machines show lots of headroom; overloaded < 1.
          process_speed: this.playback === 2 ? (this.currentSpeed() >= 1 ? 25 : this.currentSpeed()) : 0,
          state: this.playback,
          track: playing ? 1 : 0,
          tracks_total: playing ? 1 : 0,
          volume: this.fmtVolume(this.volume),
        },
        undefined,
        meta,
      );
    },

    GetModes: () => this.doc("GetModes", {}, undefined, this.profile.modes.map((m) => element("ModesItem", { ...m })).join("")),
    GetFilters: () =>
      this.doc(
        "GetFilters",
        {},
        undefined,
        this.lists.filters
          .map((f) => element("FiltersItem", { arg: f.arg, index: f.index, name: f.name, value: f.value }))
          .join(""),
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
    MatrixListProfiles: () =>
      this.doc(
        "MatrixListProfiles",
        { result: "OK" },
        undefined,
        this.opts.matrixProfiles.map((name) => element("MatrixProfile", { name })).join(""),
      ),
    MatrixGetProfile: () => this.ok("MatrixGetProfile", { value: this.matrixProfile }),
    // Reported (HQPTuner): any name gets OK and State echoes it, even unknown ones.
    MatrixSetProfile: (req) => {
      this.matrixProfile = req.attrs.value ?? "";
      return this.ok("MatrixSetProfile");
    },
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
      // Filters have ratio rules too (manual §4.6), so a filter change can stall.
      this.checkCombo();
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
    // Inferred: when configured, it toggles and echoes the new value.
    SetConvolution: (req) => {
      if (this.opts.convolutionConfigured) this.convolution = req.attrs.value === "1";
      return this.ok("SetConvolution", { value: this.convolution });
    },

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
    // Inferred: Previous/Next move one track and restart the position.
    Previous: () => {
      this.position = 0;
      return this.ok("Previous");
    },
    Next: () => {
      this.position = 0;
      return this.ok("Next");
    },
    // Measured (5.35.10): plain PlaylistAdd is accepted; start="1" makes the playlist
    // the active transport, without it Play stays on the previous source (Roon).
    PlaylistAdd: (req) => {
      if (req.attrs.clear === "1") this.playlist = [];
      this.playlist.push(req.attrs.uri ?? "");
      if (req.attrs.start === "1") this.feeder = "playlist";
      return this.ok("PlaylistAdd");
    },
    PlaylistClear: () => {
      this.playlist = [];
      return this.ok("PlaylistClear");
    },
    SelectTrack: (req) => {
      const i = Number(req.attrs.index ?? 0);
      if (i >= 0 && i < this.playlist.length && this.feeder === "playlist") {
        this.playlistIndex = i;
        this.position = 0;
      }
      return this.ok("SelectTrack");
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

  /** Connections accepted so far. */
  connections = 0;

  private serve(sock: Socket) {
    this.connections++;
    this.sockets.add(sock);
    let first = true;
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
          if (first) {
            first = false;
            await this.sleep(DELAY.firstRequest);
          }
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
  listenDiscovery(port = 0, group = "239.192.0.199"): Promise<number> {
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
        resolve(udp.address().port);
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
