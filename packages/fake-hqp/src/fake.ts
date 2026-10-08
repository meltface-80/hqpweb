// A fake HQPlayer for development and CI. It reproduces the behaviour measured
// on 2026-10-02 (design §2.1, §2.3). Where nothing was measured it picks the
// least convenient plausible behaviour and says so in an "Inferred:" comment,
// so client code that copes with the fake should cope with the real thing.
import { element, parseDocument, type AttrValue, type Element } from "@app/protocol";
import { defaultIncompatible, slotFor, type FakeOptions } from "./options.ts";
import type { ModeLists, Profile, Remembered } from "./profile.ts";
import { ControlServer } from "./server.ts";

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
  /** After such a stop on its own playlist, Play shows state 2 but the position doesn't move until a Stop (measured, 5.35.10). */
  stuck = false;
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
  /** Discovery probes to ignore before answering (simulated UDP loss); tests set it. */
  dropProbes = 0;
  /** Status counters (measured present, always 0 in captures); tests set them. */
  apod = 0;
  clips = 0;
  private prepared = new Set<string>();
  private lastTick = 0;
  private timers = new Set<NodeJS.Timeout>();
  /**
   * Fault injection: commands named here reply OK and change nothing, which is how
   * a no-op looks on the real thing (design §2.1). For testing read-back checks.
   */
  readonly ignore = new Set<string>();
  /** Every request received, for tests. */
  readonly received: string[] = [];
  /** Set when a command killed HQPlayer (modeSwitchWhilePlayingCrashes). */
  crashed = false;

  constructor(profile: Profile, opts: FakeOptions = {}) {
    this.profile = profile;
    this.opts = {
      timeScale: opts.timeScale ?? 1,
      idleTimeoutMs: opts.idleTimeoutMs ?? 156_000,
      incompatible: opts.incompatible ?? defaultIncompatible,
      speed: opts.speed ?? (() => 1),
      now: opts.now ?? Date.now,
      matrixProfiles: opts.matrixProfiles ?? [],
      convolutionConfigured: opts.convolutionConfigured ?? false,
      log: opts.log,
      modeSwitchWhilePlayingCrashes: opts.modeSwitchWhilePlayingCrashes ?? true,
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
    return active && slotFor(this.sourceRate) === "Nx" ? this.rem.filterNx : this.rem.filter1x;
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
    const now = this.opts.now(); // the first reading only sets the baseline
    if (this.playback === 2 && !this.stuck) this.position += ((now - (this.lastTick || now)) / 1000) * this.currentSpeed();
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
      // Resumes by itself with Roon as the source (measured, §2.3). From its own playlist
      // it stays stopped (measured, 5.35.10); Stop, then Play, resumed it once and not once.
      if (this.feeder === "Roon")
        this.later(DELAY.resume, () => {
          if (this.playback === 0 || this.playback === 3) this.playback = 2;
        });
      else this.stuck = true;
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
          apod: this.apod,
          clips: this.clips,
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
      if (this.playback === 2 && this.opts.modeSwitchWhilePlayingCrashes) {
        this.crashed = true; // HQPlayer is gone: every connection drops, nothing listens
        void this.net.close();
        return this.ok("SetMode"); // never delivered
      }
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
        // Inferred, not measured: a bad shaper stalls like a bad rate (hqpweb rolls back either way).
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
    // Measured (5.17.2): Seek jumps within a local file; an unseekable stream (Roon,
    // or HTTP without range support) replies with an error naming the stream reader.
    Seek: (req) => {
      if (this.feeder === "Roon") return this.doc("Seek", { result: "Error" }, "stream is not seekable");
      this.position = Math.min(Math.max(0, Number(req.attrs.position ?? 0)), 300);
      return this.ok("Seek");
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
    // Measured (6.2.3): items carry the track's rate even when it can't start. The
    // fake's tracks all play at sourceRate.
    PlaylistGet: () =>
      this.doc(
        "PlaylistGet",
        { album: 0 },
        undefined,
        this.playlist
          .map((uri, i) =>
            element("PlaylistItem", { index: i + 1, rate: this.sourceRate, length: 300, song: uri.split("/").pop() ?? "" }),
          )
          .join(""),
      ),
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
      this.stalled = this.stuck = false; // clears the auto-resume (inferred) and a stuck Play (measured, 5.35.10)
      this.playback = 0;
      this.position = 0;
      return this.ok("Stop");
    },
  };

  // ---- network (server.ts) ---------------------------------------------------

  private readonly net = new ControlServer({
    handle: (xml) => this.handle(xml),
    discoverReply: () => {
      if (this.dropProbes > 0) {
        this.dropProbes--; // simulated UDP loss
        return null;
      }
      return this.doc(
        "discover",
        { name: this.profile.info.name, result: "OK", version: this.profile.discover.version },
        "hqplayer",
      );
    },
    idleTimeoutMs: () => this.opts.idleTimeoutMs,
    firstRequest: () => this.sleep(DELAY.firstRequest),
  });

  /** The bound TCP port, once listening. */
  get port(): number {
    return this.net.port;
  }
  /** Open control connections. */
  get sockets() {
    return this.net.sockets;
  }
  /** Control connections accepted so far. */
  get connections() {
    return this.net.connections;
  }

  /** Listen for TCP control connections. Defaults to loopback on an ephemeral port. */
  listen(port = 0, host = "127.0.0.1") {
    return this.net.listen(port, host);
  }

  /** Answer discovery probes on UDP (off by default; see server.ts). */
  listenDiscovery(port = 0, group = "239.192.0.199") {
    return this.net.listenDiscovery(port, group);
  }

  async close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await this.net.close();
  }
}
