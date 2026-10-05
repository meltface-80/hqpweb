import { describe, expect, it } from "vitest";
import type { Capabilities, Failure, Snapshot } from "./api.ts";
import {
  apodization,
  context,
  filterItems,
  filterTaken,
  inUseSlot,
  otherSourceNotes,
  ratioLabel,
  rateItems,
  rateOptions,
  shaperItems,
  shaperTaken,
  wedge,
} from "./hints.ts";

// A small PCM instance (names as HQPlayer 5 lists them) and a snapshot builder.
const named = (names: string[]) => names.map((name, index) => ({ index, name }));
const FILTERS = named(["poly-sinc-gauss-xla", "FFT", "sinc-M", "poly-sinc-hb"]);
const RATES = [0, 44_100, 48_000, 88_200, 176_400, 192_000].map((rate, index) => ({ index, rate, allowed: true }));
const pcm = (knownBad: Failure[] = []): Capabilities => ({
  engine: "5.35.10",
  mode: { index: 1, name: "PCM", value: 0 },
  modes: [],
  filters: FILTERS,
  shapers: named(["NS5", "TPDF"]),
  rates: RATES,
  rateSettable: true,
  matrixProfiles: [],
  volumeRange: { min: -60, max: 0, enabled: true },
  knownBad,
});
const sdm = (): Capabilities => ({
  ...pcm(),
  mode: { index: 2, name: "SDM (DSD)", value: 1 },
  shapers: named(["ASDM7EC", "AHM7EC8B"]),
  rates: [0, 11_289_600, 45_158_400].map((rate, index) => ({ index, rate, allowed: true })),
});
const at = (caps: Capabilities, hz: number) => caps.rates.find((r) => r.rate === hz)!.index;
const filter = (name: string) => FILTERS.find((f) => f.name === name)!.index;

function snap(o: {
  rate?: number;
  source?: number | null;
  queued?: number;
  playing?: boolean;
  filter1x?: string;
  filterNx?: string;
  shaper?: number;
  activeRate?: number;
}): Snapshot {
  const playing = o.playing ?? true;
  return {
    status: {
      state: playing ? 2 : 0,
      activeRate: o.activeRate ?? 384_000,
      source: playing && o.source !== null ? { sampleRate: o.source ?? 44_100, bits: 24, channels: 2, song: "x" } : null,
    },
    state: {
      rate: o.rate ?? 0,
      filter1x: filter(o.filter1x ?? "poly-sinc-gauss-xla"),
      filterNx: filter(o.filterNx ?? "poly-sinc-gauss-xla"),
      shaper: o.shaper ?? 0,
    },
    ...(o.queued ? { queuedRate: o.queued } : {}),
  } as unknown as Snapshot;
}

describe("context", () => {
  it("takes the source from the queued track when nothing plays (a track that can't start leaves Status blank)", () => {
    expect(context(pcm(), snap({ playing: false, queued: 48_000 })).source).toBe(48_000);
  });

  it("uses the configured output rate when fixed, not HQPlayer's possibly stale active rate", () => {
    const caps = pcm();
    expect(context(caps, snap({ rate: at(caps, 176_400), activeRate: 384_000 })).outRate).toBe(176_400);
  });

  it("knows which filter the source uses: 1x below 50 kHz, Nx above (manual §4.6)", () => {
    const s = { filter1x: "poly-sinc-hb", filterNx: "sinc-M" };
    expect(context(pcm(), snap({ ...s, source: 44_100 })).inUseFilter).toBe("poly-sinc-hb");
    expect(context(pcm(), snap({ ...s, source: 96_000 })).inUseFilter).toBe("sinc-M");
  });
});

describe("filter picker", () => {
  it("blocks a filter that can't do the ratio, saying why", () => {
    const caps = pcm();
    const fft = filterItems(context(caps, snap({ rate: at(caps, 192_000) })), "1x").find((f) => f.name === "FFT")!;
    expect(fft.blocked).toBe("needs a power-of-two ratio; 44.1k → 192k is 4.35×");
  });

  it("blocks nothing when the rate is on Auto (HQPlayer picks one that fits)", () => {
    expect(filterItems(context(pcm(), snap({ rate: 0 })), "1x").filter((f) => "blocked" in f)).toEqual([]);
  });

  it("doesn't judge the Nx slot by a 44.1 kHz source (it isn't used)", () => {
    const caps = pcm();
    expect(filterItems(context(caps, snap({ rate: at(caps, 192_000) })), "Nx").filter((f) => "blocked" in f)).toEqual([]);
  });

  it("warns about a combination that failed here before", () => {
    const caps = pcm([
      {
        mode: "PCM",
        rateHz: 384_000,
        filterNx: "poly-sinc-gauss-xla",
        filter1x: "poly-sinc-hb",
        shaper: "NS5",
        reason: "playback stopped",
        at: "2026-10-04T00:00:00Z",
      },
    ]);
    const hb = filterItems(context(caps, snap({})), "1x").find((f) => f.name === "poly-sinc-hb")!;
    expect(hb.warn).toBe("failed here before at these settings (playback stopped)");
  });
});

describe("rate sheet", () => {
  it("offers the rates a filter can do, the closest marked, and Auto when the rate is fixed", () => {
    const caps = pcm();
    const r = rateOptions(context(caps, snap({ rate: at(caps, 192_000) })), "FFT");
    expect(r.options.map((o) => o.rate)).toContain(176_400);
    expect(r.options.find((o) => o.nearest)?.rate).toBe(176_400);
    expect(r.options.map((o) => o.rate)).not.toContain(192_000);
    expect(r.auto).toBe(true);
  });
});

describe("the next track won't start (guard 1)", () => {
  const caps = pcm();
  const stuck = { playing: false, queued: 44_100, rate: at(caps, 192_000), filter1x: "FFT" };

  it("explains a queued track whose ratio the filter can't do", () => {
    expect(wedge(context(caps, snap(stuck)))).toMatchObject({ slot: "filter1x", filter: "FFT", cause: "filter" });
  });

  it("says nothing while playing, or with the rate on Auto", () => {
    expect(wedge(context(caps, snap({ ...stuck, playing: true, source: 44_100 })))).toBeNull();
    expect(wedge(context(caps, snap({ ...stuck, rate: 0 })))).toBeNull();
  });
});

describe("other source rates at a fixed output rate (guard 2)", () => {
  it("names the source rates the filters can't play", () => {
    const caps = pcm();
    expect(otherSourceNotes(context(caps, snap({ rate: at(caps, 176_400), filter1x: "FFT" })))).toEqual([
      "FFT won't play 48k sources",
    ]);
  });
});

describe("modulator and output-rate pickers", () => {
  it("warns that an AHM modulator won't play below its rate floor (measured stall)", () => {
    const caps = sdm();
    const items = shaperItems(context(caps, snap({ rate: at(caps, 11_289_600) })));
    expect(items.find((s) => s.name === "AHM7EC8B")!.warn).toMatch(/^won't play/);
    expect(items.find((s) => s.name === "ASDM7EC")!.warn).toBeUndefined();
  });

  it("warns about output rates the filter in use can't reach, and disables ones over a limit", () => {
    const caps = pcm();
    caps.rates = caps.rates.map((r) => (r.rate === 88_200 ? { ...r, allowed: false } : r));
    const items = rateItems(context(caps, snap({ filter1x: "FFT" })));
    expect(items.find((r) => r.rate === 192_000)!.warn).toMatch(/^won't play: FFT needs a power-of-two ratio/);
    expect(items.find((r) => r.rate === 176_400)!.warn).toBeUndefined();
    expect(items.find((r) => r.rate === 88_200)!.disabled).toBe(true);
  });
});

describe("the filter slot in use", () => {
  it("follows the source: 1x below 50 kHz, Nx above; none while stopped", () => {
    expect(inUseSlot(snap({ source: 48_000 }))).toBe("1x");
    expect(inUseSlot(snap({ source: 88_200 }))).toBe("Nx");
    expect(inUseSlot(snap({ playing: false }))).toBeNull();
  });
});

describe("the apodization counter (manual §2.6)", () => {
  it("suggests an apodizing filter once it passes 10 in a track, unless the filter in use is one", () => {
    expect(apodization(10, false)).toBeNull();
    expect(apodization(11, false)).toBe("suggest");
    expect(apodization(11, "partial")).toBe("suggest");
    expect(apodization(11, true)).toBe("handled");
  });
});

describe("the ✓ next to a choice (HQPlayer reports what it actually uses)", () => {
  const base = snap({ source: 44_100 });
  const playing = { ...base, status: { ...base.status, activeFilter: "sinc-M", activeShaper: "NS5" } } as Snapshot;
  it("shows whether the chosen filter is the one HQPlayer uses, in the slot in use", () => {
    expect(filterTaken(playing, "1x", "1x", "sinc-M")).toBe(true);
    expect(filterTaken(playing, "1x", "1x", "FFT")).toBe(false);
    expect(filterTaken(playing, "1x", "Nx", "sinc-M")).toBeNull();
  });
  it("says nothing while stopped", () => {
    expect(filterTaken(snap({ playing: false }), "1x", "1x", "sinc-M")).toBeNull();
    expect(shaperTaken(snap({ playing: false }), "NS5")).toBeNull();
  });
  it("shows whether the chosen dither or modulator is the one in use", () => {
    expect(shaperTaken(playing, "NS5")).toBe(true);
    expect(shaperTaken(playing, "TPDF")).toBe(false);
  });
});

describe("details the first tests missed (found by mutation testing)", () => {
  it("uses HQPlayer's active rate as the output rate when the rate is on Auto", () => {
    expect(context(pcm(), snap({ rate: 0, activeRate: 384_000 })).outRate).toBe(384_000);
  });

  it("shows a filter that can't do the ratio as blocked, not as a warning", () => {
    const caps = pcm();
    const fft = filterItems(context(caps, snap({ rate: at(caps, 192_000) })), "1x").find((f) => f.name === "FFT")!;
    expect(fft.warn).toBeUndefined();
  });

  it("finds the slot in use from State when Status has no source details", () => {
    const s = snap({ source: null, filter1x: "poly-sinc-hb", filterNx: "sinc-M" });
    expect(inUseSlot({ ...s, state: { ...s.state, filterInUse: filter("sinc-M") } })).toBe("Nx");
    expect(inUseSlot({ ...s, state: { ...s.state, filterInUse: filter("poly-sinc-hb") } })).toBe("1x");
  });

  it("labels the ratio as source → output, and leaves it blank with no source", () => {
    const caps = pcm();
    expect(ratioLabel(context(caps, snap({ rate: at(caps, 176_400) })))).toBe("44.1 kHz → 176.4 kHz");
    expect(ratioLabel(context(caps, snap({ playing: false })))).toBe("");
  });

  it("offers Auto only when the rate is fixed and Auto is allowed", () => {
    const caps = pcm();
    expect(rateOptions(context(caps, snap({ rate: 0 })), "FFT").auto).toBe(false);
    const noAuto = { ...caps, rates: caps.rates.map((r) => (r.rate === 0 ? { ...r, allowed: false } : r)) };
    expect(rateOptions(context(noAuto, snap({ rate: at(caps, 192_000) })), "FFT").auto).toBe(false);
  });

  it("lets HQPlayer 6's own filter description decide the ratio rule", () => {
    const caps = pcm();
    caps.filters = caps.filters.map((f) => (f.name === "FFT" ? { ...f, description: "3/5 ⥣ Any" } : f));
    const c = context(caps, snap({ rate: at(caps, 192_000) }));
    expect(rateOptions(c, "FFT").options.map((o) => o.rate)).toContain(192_000);
  });

  it("says nothing about the next track when none is queued", () => {
    const caps = pcm();
    expect(wedge(context(caps, snap({ playing: false, rate: at(caps, 192_000), filter1x: "FFT" })))).toBeNull();
  });

  it("blames the modulator when it's the modulator that can't start the queued track (SDM)", () => {
    const caps = sdm();
    const s = snap({ playing: false, queued: 44_100, rate: at(caps, 11_289_600), shaper: 1 }); // AHM7EC8B at DSD256
    expect(wedge(context(caps, s))).toMatchObject({ cause: "modulator" });
  });

  it("notes nothing about other sources with the rate on Auto", () => {
    expect(otherSourceNotes(context(pcm(), snap({ rate: 0, filter1x: "FFT" })))).toEqual([]);
  });

  it("shows a modulator's generation in SDM (HQPlayer 6 says it), and none for PCM dither", () => {
    const caps = sdm();
    caps.shapers = caps.shapers.map((s) => ({ ...s, description: "Gen8" }));
    expect(shaperItems(context(caps, snap({})))[0]).toMatchObject({ gen: 8 });
    expect(shaperItems(context(pcm(), snap({})))[0]).not.toHaveProperty("gen");
  });

  it("judges output rates against the source only when there is one", () => {
    const caps = pcm();
    const items = rateItems(context(caps, snap({ playing: false, filter1x: "FFT" })));
    expect(items.find((r) => r.rate === 192_000)!.warn).toBeUndefined();
  });
});

describe("more details (second mutation pass)", () => {
  it("shows a rate's own note, e.g. why it's over a limit", () => {
    const caps = pcm();
    caps.rates = caps.rates.map((r) => (r.rate === 192_000 ? { ...r, note: "above this DAC's limit" } : r));
    expect(rateItems(context(caps, snap({})))!.find((r) => r.rate === 192_000)!.note).toBe("above this DAC's limit");
  });

  it("says nothing about the next track while playing, even without track details, or while paused", () => {
    const caps = pcm();
    const stuck = snap({ playing: false, queued: 44_100, rate: at(caps, 192_000), filter1x: "FFT" });
    const playingNoDetails = { ...stuck, status: { ...stuck.status, state: 2 } } as Snapshot;
    const pausedWithSource = {
      ...stuck,
      status: { ...stuck.status, state: 1, source: { sampleRate: 44_100, bits: 24, channels: 2, song: "x" } },
    } as Snapshot;
    expect(wedge(context(caps, playingNoDetails))).toBeNull();
    expect(wedge(context(caps, pausedWithSource))).toBeNull();
  });

  it("notes nothing about other sources with the rate on Auto, for the Nx filter too", () => {
    expect(otherSourceNotes(context(pcm(), snap({ rate: 0, activeRate: 384_000, filterNx: "FFT" })))).toEqual([]);
  });

  it("shows generations only for SDM modulators, even if a PCM dither had one", () => {
    const caps = pcm();
    caps.shapers = caps.shapers.map((s) => ({ ...s, description: "Gen8" }));
    expect(shaperItems(context(caps, snap({})))[0]).not.toHaveProperty("gen");
  });
});
