// What stops playback in the fake: its own small table, written apart from the app's
// predictions (@app/protocol compat.ts). If the fake asked the app's code, a test of
// those predictions against the fake would agree with itself whatever the rules said.
// So each rule here cites its own evidence, and the contract test checks that the app
// predicts every stop listed here.

export interface Combination {
  modeName: string;
  rateHz: number;
  shaperName: string;
  filterName: string;
  sourceRate: number;
}

/**
 * Which filter plays a source: the 1x filter below 50 kHz, the Nx filter above.
 * Manual §4.6; the fake's own copy of the rule.
 */
export const slotFor = (sourceRate: number): "1x" | "Nx" => (sourceRate < 50_000 ? "1x" : "Nx");

const isPow2 = (n: number) => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;

interface Rule {
  /** What the rule says, and how we know. */
  evidence: string;
  /** A combination we saw stop (or the manual says stops), checked by the contract test. */
  example: Combination;
  stops: (c: Combination) => boolean;
}

const sdm = (c: Combination) => c.modeName.startsWith("SDM");

export const STOP_RULES: Rule[] = [
  {
    evidence:
      "AHM modulators below 40.96 MHz (DSD1024). Measured: AHM7EC8B stopped at DSD256 and DSD512 " +
      "(design §2.3, macOS 5.32.5). Inferred for the rest of the family from the manual's floor (§4.5).",
    example: {
      modeName: "SDM (DSD)",
      rateHz: 22_579_200,
      shaperName: "AHM7EC8B",
      filterName: "poly-sinc-gauss-xla",
      sourceRate: 44_100,
    },
    stops: (c) => sdm(c) && c.shaperName.startsWith("AHM") && c.rateHz > 0 && c.rateHz < 40_960_000,
  },
  {
    evidence:
      "The sinc-M family needs a power-of-two ratio. Measured: sinc-M stopped at 44.1k → 192k " +
      "(design §2.3, Linux 5.35.10), refused 3× and played 2× down (Desktop 5.17.2). Inferred for the family.",
    example: { modeName: "PCM", rateHz: 192_000, shaperName: "TPDF", filterName: "sinc-M", sourceRate: 44_100 },
    stops: (c) => {
      if (!/^sinc-(M|S|L)/.test(c.filterName) || !c.rateHz || !c.sourceRate) return false;
      const r = c.rateHz / c.sourceRate;
      return !isPow2(r) && !isPow2(1 / r);
    },
  },
];

/** The fake's default: stops when any rule here says so. Anything not listed plays. */
export const stopsByTable = (c: Combination): boolean => STOP_RULES.some((rule) => rule.stops(c));
