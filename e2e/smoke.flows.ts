// The fake HQPlayers for smoke.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { setFilter, setRate, type Flows } from "./flows-kit.ts";

export const flows: Flows = {
  // SDM at auto rate, playing from Roon: every filter fits.
  pick: { name: "Pick a filter", profile: "desktop5-mac-sdm" },
  // Playing, on a machine that runs poly-sinc-gauss-long at half real time: picking it is rolled back.
  rollback: {
    name: "Rollback",
    profile: "desktop5-mac-sdm",
    speed: ({ filterName }) => (filterName === "poly-sinc-gauss-long" ? 0.5 : 1),
  },
  // PCM fixed at 192k, playing 44.1k: power-of-two filters (FFT) can't convert 4.35×.
  ratio: {
    name: "Ratio",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 192_000);
      f.playback = 2;
    },
  },
  // Stopped, fixed at 192k with FFT as the 1x filter: a queued 44.1k track can't start.
  wedge: {
    name: "Queued track",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 192_000);
      setFilter(f, "filter1x", "FFT");
      f.playback = 0;
      f.feeder = "playlist";
    },
  },
  // Playing from HQPlayer's own playlist at 176.4k with sinc-M: 192k stops it, and it doesn't resume by itself.
  restart: {
    name: "Restart",
    profile: "desktop5-linux-pcm",
    setup: (f) => {
      setRate(f, 176_400);
      setFilter(f, "filter1x", "sinc-M");
      f.feeder = "playlist";
      f.playlist = ["/music/Example Artist/Example Album/01 - Example.flac"];
      f.playback = 2;
    },
  },
  jump: { name: "Volume jump", profile: "desktop5-mac-sdm", setup: (f) => (f.volume = -44) },
  // A recording that keeps needing apodization, played through a filter that isn't apodizing.
  apod: {
    name: "Apodization",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setFilter(f, "filter1x", "poly-sinc-hb");
      f.apod = 25;
    },
  },
  volume: { name: "Volume", profile: "desktop5-mac-sdm", setup: (f) => (f.volume = -30) },
  advanced: { name: "Advanced", profile: "desktop5-linux-pcm", setup: (f) => (f.playback = 2) },
  about: { name: "About", profile: "desktop5-mac-sdm" },
  restartcap: { name: "Restart cap", profile: "desktop5-mac-sdm" },
  // Settings → Your setup: answers saved on the server, per instance.
  setup: { name: "Setup", profile: "desktop5-mac-sdm" },
};
