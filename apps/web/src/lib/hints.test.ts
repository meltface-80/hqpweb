import { describe, expect, it } from "vitest";
import type { Capabilities, Failure, Snapshot } from "./api.ts";
import {
  apodization,
  context,
  filterItems,
  inUseSlot,
  otherSourceNotes,
  rateItems,
  rateOptions,
  shaperItems,
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
