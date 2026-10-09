// The fake HQPlayers for v2-fit.spec.ts, keyed by instance id (e2e/stack.ts loads every *.flows.ts).
import { setRate, setShaper, type Flows } from "./flows-kit.ts";

const slowSincL = {
  name: "",
  profile: "desktop5-mac-sdm" as const,
  setup: (f: Parameters<NonNullable<Flows[string]["setup"]>>[0]) => {
    setRate(f, 11_289_600);
    setShaper(f, "ASDM7EC-super");
    f.playback = 2;
  },
  speed: ({ filterName, rateHz }: { filterName: string; rateHz: number }) =>
    /^sinc-Lh?$/.test(filterName) && rateHz >= 11_289_600 ? 0.5 : 1,
};

export const flows: Flows = {
  // The same machine, for "Forget this" and for the switch that turns sorting off.
  v2forget: { ...slowSincL, name: "V2 forget" },
  v2plain: { ...slowSincL, name: "V2 plain" },
  // Playing a 44.1k track at a fixed DSD256 with ASDM7EC-super, on a machine that can't keep
  // up with sinc-L or sinc-Lh at DSD256 and above (half real time), but can at DSD128.
  v2fit: {
    name: "V2 fit",
    profile: "desktop5-mac-sdm",
    setup: (f) => {
      setRate(f, 11_289_600);
      setShaper(f, "ASDM7EC-super");
      f.playback = 2;
    },
    speed: ({ filterName, rateHz }) => (/^sinc-Lh?$/.test(filterName) && rateHz >= 11_289_600 ? 0.5 : 1),
  },
};
