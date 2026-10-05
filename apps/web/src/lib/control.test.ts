import { describe, expect, it } from "vitest";
import type { RoonZone, Snapshot } from "./api.ts";
import { control, isRisky, stepVolume, zoneMismatch } from "./control.ts";

const snap = (state: 0 | 1 | 2, song: string | null): Snapshot =>
  ({
    status: { state, source: song === null ? null : { sampleRate: 44_100, bits: 24, channels: 2, song } },
  }) as unknown as Snapshot;
const zone = (state: string): RoonZone =>
  ({
    id: "z",
    name: "Zone",
    state,
    allowed: { play: true, pause: true, next: false, previous: true, seek: true },
  }) as unknown as RoonZone;

describe("who controls playback (measured, design §2.2)", () => {
  it("with Roon as the source and no Roon link, offers only Stop", () => {
    const c = control(snap(2, "Roon"), null);
    expect(c.stopOnly).toBe(true);
    expect(c.allowed("play")).toBe(false);
    expect(c.route("stop")).toBe("hqplayer");
  });

  it("with a Roon zone, sends everything but Stop to Roon, and follows Roon's own allowances", () => {
    const c = control(snap(2, "Roon"), zone("playing"));
    expect(c.stopOnly).toBe(false);
    expect(c.route("play")).toBe("roon");
    expect(c.route("next")).toBe("roon");
    expect(c.route("stop")).toBe("hqplayer");
    expect(c.allowed("next")).toBe(false);
    expect(c.playing).toBe(true);
  });

  it("when HQPlayer plays its own playlist, uses HQPlayer's controls even with a Roon zone mapped", () => {
    const c = control(snap(2, "01 - Example.flac"), zone("paused"));
    expect(c.viaRoon).toBeNull();
    expect(c.route("play")).toBe("hqplayer");
    expect(c.allowed("next")).toBe(true);
  });

  it("while HQPlayer is idle, lets Roon drive (Roon can start it)", () => {
    expect(control(snap(0, null), zone("paused")).route("play")).toBe("roon");
  });

  it("flags Roon playing while this HQPlayer is stopped (likely the wrong zone)", () => {
    expect(zoneMismatch(snap(0, null), zone("playing"))).toBe(true);
    expect(zoneMismatch(snap(2, "Roon"), zone("playing"))).toBe(false);
  });
});

describe("changes and volume", () => {
  it("counts filter, rate, mode and the like as risky; volume and toggles as not", () => {
    expect(isRisky({ filter1x: "x" })).toBe(true);
    expect(isRisky({ volume: -30, invert: true })).toBe(false);
  });

  it("steps the volume and clamps it to HQPlayer's maximum", () => {
    expect(stepVolume(-30, 1, { min: -60, max: -3 })).toBe(-29);
    expect(stepVolume(-3.5, 1, { min: -60, max: -3 })).toBe(-3);
    expect(stepVolume(-3, 1, { min: -60, max: -3 })).toBeNull();
    expect(stepVolume(-60, -1, { min: -60, max: -3 })).toBeNull();
  });
});
