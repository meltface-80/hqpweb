import { describe, expect, it } from "vitest";
import type { RoonZone, Snapshot } from "./api.ts";
import { miniPlay, miniTitle } from "./mini.ts";

const snap = (state: number, song: string | null): Snapshot =>
  ({
    status: {
      state,
      activeRate: 11_289_600,
      activeMode: "SDM (DSD)",
      source: song === null ? null : { song, sampleRate: 44_100 },
    },
    state: {},
  }) as unknown as Snapshot;
const zone = (state: string): RoonZone =>
  ({
    id: "z",
    name: "LR",
    state,
    hqplayer: true,
    nowPlaying: { track: "Morning Song", artist: "Example Artist", album: "" },
    allowed: { play: true, pause: true, next: true, previous: true, seek: true },
  }) as RoonZone;

describe("mini bar", () => {
  it("names the track from Roon when linked, else what HQPlayer plays at", () => {
    expect(miniTitle(snap(2, "Roon"), zone("playing"))).toBe("Morning Song");
    expect(miniTitle(snap(2, "Roon"), null)).toBe("Playing · DSD256");
    expect(miniTitle(snap(1, "x.flac"), null)).toBe("Paused");
  });
  it("offers pause or play, but nothing when Roon feeds HQPlayer without a link", () => {
    expect(miniPlay(snap(2, "Roon"), zone("playing"))).toEqual({ action: "pause", label: "Pause" });
    expect(miniPlay(snap(2, "Roon"), null)).toBeNull();
    expect(miniPlay(snap(1, "x.flac"), null)).toEqual({ action: "play", label: "Play" });
  });
});
