// What each upsampling filter is like, for the (i) beside it: one family line and one line
// of its own, in plain words, every claim cited. Paraphrased, never copied: HQPlayer 6's
// built-in help, the HQPlayer 6.1.1 Desktop manual §4.6 (5.13's for filters 6 dropped), and Jussi
// Laako's (Signalyst's developer) forum posts, dated, with older ones marked "possibly
// dated" (RULES' age rule, policy.ts). Research and links: docs/filter-research.local.md
// (private). Characters, not a ranking: HQPlayer's own n/5 ratings are relative, and past
// the defaults, choosing is taste (Jussi).

export interface Cite {
  label: string;
  url?: string;
  /** "YYYY-MM", for forum posts. */
  date?: string;
}
export interface FilterNote {
  /** The family's character, then this filter's own. */
  lines: string[];
  cites: Cite[];
}

const H6: Cite = { label: "HQPlayer 6 help" };
const M: Cite = { label: "Manual 6.1.1 §4.6" };
const M5: Cite = { label: "Manual 5.13 §4.6" };
const roon = (topicPost: string, slug: string) => `https://community.roonlabs.com/t/${slug}/${topicPost}`;
const J = (slug: string, topicPost: string, date: string): Cite => ({ label: "Jussi", url: roon(topicPost, slug), date });
const FILTERS_2024 = "which-hqp-filter-are-you-using-2024";
const J_DEFAULTS = J(FILTERS_2024, "261032/1381", "2026-06");
const J_GAUSS_STEP = J("hqptuner-an-improved-configuration-interface-for-hqplayer-embedded", "322881/80", "2026-08");
const J_NEUTRAL = J("most-neutral-resampling-filter-in-hq-player", "290660/2", "2025-01");
const J_EXT2_PAIRS = J("hqplayer-desktop-thread", "166213/1993", "2025-09");
const J_EXT3_RENAME = J(FILTERS_2024, "261032/1165", "2025-09");
const J_XLA_96K = J("hqplayer-desktop-presets-remote-preset-switching", "322972/8", "2026-09");
const J_HIRES_LOSSY = J(FILTERS_2024, "261032/1375", "2026-06");
const J_SINC_L = J("mac-studio-m5-max", "325102/4", "2026-09");
const J_EXT2_SHORT = J("eversolo-now-supports-naa", "312000/94", "2026-07");
const J_SHORT_MP = J(FILTERS_2024, "261032/1384", "2026-06");
const J_16M = J("best-native-dsd-dacs-for-use-with-hqplayer", "132298/3157", "2026-02");

interface Entry {
  match: (name: string) => boolean;
  family?: string;
  line: string;
  cites: Cite[];
}
const is =
  (...names: string[]) =>
  (n: string) =>
    names.includes(n);
const re = (r: RegExp) => (n: string) => r.test(n);

// HQPlayer 6.1.1 manual §4.6, for the Gaussians other than hires and halfband.
const GAUSS_DSD = " In DSD output it runs in two stages, at least 16x in between.";

const PHASE: Record<string, string> = {
  lp: "Linear phase: ringing before and after each transient, evenly.",
  mp: "Minimum phase: no ringing before a transient, more after it.",
  ip: "Intermediate phase: a little ringing before a transient.",
};
const phaseOf = (n: string) => PHASE[/-(lp|mp|ip)(-2s)?$/.exec(n)?.[1] ?? ""];

// Most specific first; the first match gives the filter's own line, the first with a
// family gives the family line.
const ENTRIES: Entry[] = [
  // ---- Gaussian ----
  {
    match: is("poly-sinc-gauss-long"),
    line:
      "Long, very high attenuation, apodizing. HQPlayer's default 1x filter; Jussi calls it probably the most neutral, since it also corrects what the Apod counter finds." +
      GAUSS_DSD,
    cites: [H6, M, J_DEFAULTS, J_NEUTRAL],
  },
  {
    match: re(/^poly-sinc-gauss-hires-(lp|ip|mp)$/),
    line: "Made for hi-res sources; very high attenuation, apodizing. The -lp version is HQPlayer's default Nx filter. Jussi: also works well on lossy or messy sources.",
    cites: [H6, M, J_DEFAULTS, J_HIRES_LOSSY],
  },
  {
    match: is("poly-sinc-gauss-xla"),
    line:
      "Extra long, apodizing. On 96 kHz sources Jussi suggests a hires filter instead: the extra length costs more than it gives." +
      GAUSS_DSD,
    cites: [H6, M, J_XLA_96K],
  },
  {
    match: is("poly-sinc-gauss-xl"),
    line:
      "Extra long and not apodizing: only for the cleanest recordings. Where the Apod counter stays at 0 it sounds practically the same as -xla (Jussi, possibly dated)." +
      GAUSS_DSD,
    cites: [H6, M, J("which-hqp-filter-are-you-using-2015-2023", "6061/2124", "2021-12")],
  },
  { match: is("poly-sinc-gauss-medium"), line: "Medium length, apodizing." + GAUSS_DSD, cites: [H6, M] },
  {
    match: is("poly-sinc-gauss-short"),
    line: "Short, partly apodizing; whole-number upsampling only." + GAUSS_DSD,
    cites: [H6, M],
  },
  {
    match: re(/^poly-sinc-gauss-halfband(-s)?$/),
    line: "Half-band: a little leakage near the top of the band (-s more), very high attenuation; not apodizing, so only for the cleanest recordings.",
    cites: [H6, M],
  },
  {
    match: is("poly-sinc-gauss"),
    line: "HQPlayer 5's Gaussian for any ratio, apodizing; HQPlayer 6 lists gauss-medium in its place (probably a rename, inferred).",
    cites: [M5],
  },
  {
    match: re(/^poly-sinc-gauss/),
    family:
      "Gaussian: a balance of time and frequency behaviour. Jussi: the fastest, most accurate step response while keeping a very good frequency response.",
    line: "",
    cites: [H6, J_GAUSS_STEP],
  },
  // ---- ext2 / ext3 ----
  {
    match: is("poly-sinc-ext2-xla"),
    line: "Very steep, eight times the length of ext2-long, apodizing. This is HQPlayer 5's poly-sinc-ext3, renamed in 5.15. On 96 kHz sources Jussi suggests a hires filter instead.",
    cites: [H6, J_EXT3_RENAME, J_XLA_96K],
  },
  {
    match: is("poly-sinc-ext3"),
    line: "Very steep, eight times longer than ext2, apodizing; renamed poly-sinc-ext2-xla in 5.15.",
    cites: [M5, J_EXT3_RENAME],
  },
  { match: is("poly-sinc-ext2-xl"), line: "As ext2-xla but not apodizing: only for the cleanest recordings.", cites: [H6] },
  {
    match: is("poly-sinc-ext2-long"),
    line: "Very fast roll-off, very high attenuation, apodizing. With ext2-hires-lp, an equal alternative to HQPlayer's defaults at the same CPU cost (Jussi).",
    cites: [H6, J("cant-get-hqplayer-discovered-bonjour-seems-to-not-be-working", "312532/13", "2025-12")],
  },
  { match: is("poly-sinc-ext2-medium"), line: "Fast roll-off, high attenuation, apodizing.", cites: [H6] },
  {
    match: is("poly-sinc-ext2-short"),
    line: "Slow roll-off, partly apodizing. Whole-number upsampling only (no 44.1k↔48k, no downsampling): for any ratio, ext2-medium is its nearest neighbour.",
    cites: [H6, J_EXT2_SHORT],
  },
  {
    match: re(/^poly-sinc-ext2-hires-(lp|ip|mp)$/),
    line: "Made for hi-res sources, very high attenuation, apodizing; also suits lossy sources such as MP3 or MQA.",
    cites: [H6],
  },
  {
    match: is("poly-sinc-ext2"),
    line: "Sharp roll-off, very high attenuation, fully cut off by the top of the band; apodizing; any ratio.",
    cites: [H6, M],
  },
  {
    match: is("poly-sinc-ext"),
    line: "Sharper roll-off than poly-sinc at a similar length; partly apodizing; whole-number ratios.",
    cites: [H6, M],
  },
  {
    match: re(/^poly-sinc-ext/),
    family:
      "Extended frequency response, linear phase, leaning to timbre. Jussi: ext2 and Gaussian come in matching lengths to compare; Gaussian leans to the time domain, ext2 to the frequency domain, both good at both.",
    line: "",
    cites: [H6, J_EXT2_PAIRS],
  },
  // ---- poly-sinc, hb, xtr, mqa ----
  {
    match: re(/^poly-sinc-short-(lp|mp)(-2s)?$/),
    line: "Short ringing, bought with a slower roll-off; partly apodizing. The manual calls -short-mp the best for transients; Jussi likes it on older rock.",
    cites: [H6, M, J_SHORT_MP],
  },
  {
    match: re(/^poly-sinc-long-(lp|ip|mp)(-2s)?$/),
    line: "Longer ringing, faster roll-off; apodizing. HQPlayer 6 warns it can take a long time to set up for 44.1k↔48k conversion.",
    cites: [H6, M],
  },
  { match: re(/^poly-sinc-(lp|mp)(-2s)?$/), line: "The original all-rounder; most ratios; partly apodizing.", cites: [H6, M] },
  {
    match: re(/^poly-sinc-hb/),
    family:
      "Half-band: linear phase, not apodizing, so only for the cleanest recordings; by design it always leaks a little near the top of the band (Jussi).",
    line: "From -xs (slow roll-off, low attenuation) to -l (fast roll-off, high attenuation); plain hb is steep with high attenuation.",
    cites: [H6, M, J_NEUTRAL],
  },
  { match: re(/^poly-sinc-xtr-short-(lp|mp)(-2s)?$/), line: "Shorter versions; apodizing.", cites: [H6, M] },
  { match: re(/^poly-sinc-xtr-(lp|mp)(-2s)?$/), line: "Extreme roll-off and attenuation; partly apodizing.", cites: [H6, M] },
  {
    match: re(/^poly-sinc-xtr/),
    family: "Extreme roll-off and attenuation, any ratio, leaning to timbre.",
    line: "",
    cites: [H6, M],
  },
  {
    match: re(/^poly-sinc-mqa\/mp3-(lp|mp)$/),
    line: "Very short ringing, early gentle roll-off. As 1x: cleans up the top end of MP3 or undecoded MQA. As Nx: decoded MQA and hi-res from 88.2k, especially 176.4k and up. Apodizing.",
    cites: [H6, M],
  },
  { match: re(/^poly-sinc/), family: "poly-sinc: the general-purpose family the manual recommends most.", line: "", cites: [M] },
  // ---- sinc (million-tap, L, short…long) ----
  {
    match: is("sinc-MGa"),
    line: "Gaussian, constant length in time, apodizing: a million-tap version of gauss-xla.",
    cites: [H6, M],
  },
  {
    match: is("sinc-MG"),
    line: "Gaussian, constant length in time, not apodizing: a million-tap version of gauss-xl.",
    cites: [H6, M],
  },
  { match: is("sinc-Mx"), line: "sinc-M with a constant length in time.", cites: [H6, M] },
  { match: is("sinc-M"), line: "One million taps, very sharp; heavy on CPU and memory.", cites: [H6, M] },
  { match: is("sinc-S"), line: "Length grows with the ratio; very sharp, high attenuation.", cites: [H6, M] },
  {
    match: re(/^sinc-(S|M|Mx|MG|MGa)$/),
    family:
      "Million-tap sinc: very long and sharp, mostly apodizing; power-of-two upsampling only (HQPlayer 6 and its manual say so; hqpweb measured it).",
    line: "",
    cites: [H6, M],
  },
  {
    match: is("sinc-Lh"),
    line: "High attenuation; clearly better than sinc-L at an eighth of the load. If you like that style, Jussi suggests this one.",
    cites: [H6, M, J_SINC_L],
  },
  {
    match: is("sinc-L"),
    line: "Extremely sharp but only average attenuation. Jussi advises against it: very long filters blur transients. It can't take a 48k-family source to 44.1k-family output.",
    cites: [H6, M, J_SINC_L],
  },
  { match: re(/^sinc-L[sml]$/), line: "Average attenuation; -Ls, -Lm, -Ll are increasingly long.", cites: [H6, M] },
  { match: re(/^sinc-L/), family: "sinc-L: long, not apodizing.", line: "", cites: [H6, M] },
  { match: is("sinc-long-h"), line: "Long, high attenuation.", cites: [H6, M] },
  {
    match: re(/^sinc-(short|medium|long)$/),
    line: "Average attenuation, increasingly long. Unlike sinc-L, it converts between 44.1k and 48k families.",
    cites: [H6, M, J_SINC_L],
  },
  {
    match: re(/^sinc-(short|medium|long)/),
    family: "Adaptive-length sinc, not apodizing; any ratio (short, medium and long upsample only).",
    line: "",
    cites: [H6, M],
  },
  // ---- classic and special ----
  {
    match: is("IIR"),
    line: "Analog-like: steep, no ringing before a transient but long after (usually masked), slight ripple. Suggested for strongly percussive pop, rock and jazz.",
    cites: [H6, M],
  },
  { match: is("IIR2"), line: "As IIR, a little less steep, without the ripple.", cites: [H6, M] },
  {
    match: is("FIR"),
    line: "The usual oversampling filter most DACs have: modest ringing both sides. Suits acoustic recordings.",
    cites: [H6, M],
  },
  { match: is("asymFIR"), line: "FIR with shorter ringing before a transient and longer after.", cites: [H6, M] },
  {
    match: is("minphaseFIR"),
    line: "Minimum phase: no ringing before a transient, longer after. Suggested for studio-made, percussive music.",
    cites: [H6, M],
  },
  {
    match: is("FFT"),
    line: "A steep brick-wall applied in the frequency domain; efficient for its length; can ring before strong transients. Power-of-two ratios.",
    cites: [H6, M],
  },
  {
    match: re(/^(IIR2?|FIR|asymFIR|minphaseFIR|FFT)$/),
    family: "Classic filter: apodizing, whole-number ratios (FFT: power of two).",
    line: "",
    cites: [H6, M],
  },
  {
    match: re(/^minringFIR-(lp|mp)$/),
    line: "FIR designed for the least ringing, between polynomial and poly-sinc-short; whole-number upsampling; not apodizing.",
    cites: [H6, M],
  },
  {
    match: is("polynomial-1"),
    line: "Polynomial interpolation: no visible ringing, but a slow roll-off that leaks ultrasonic images (the 'non-ringing' filters of marketing). Not recommended.",
    cites: [H6, M],
  },
  {
    match: is("polynomial-2"),
    line: "Better rejection than polynomial-1, one cycle of ringing each side. Not recommended.",
    cites: [H6, M],
  },
  { match: is("closed-form-16M"), line: "16 million taps; offered only in DSD output.", cites: [H6, M, J_16M] },
  { match: is("closed-form-M"), line: "One million taps.", cites: [H6, M] },
  { match: is("closed-form-fast"), line: "Lighter and less precise, tuned to about 24-bit PCM.", cites: [H6, M] },
  { match: is("closed-form"), line: "Closed-form interpolation with many taps.", cites: [H6, M] },
  { match: re(/^closed-form/), family: "Closed-form: power-of-two upsampling only, not apodizing.", line: "", cites: [H6, M] },
  { match: is("ASRC"), line: "Follows a varying input rate (asynchronous); heavy, and not recommended.", cites: [H6, M] },
  { match: is("none"), line: "No rate conversion; only the word length is adjusted.", cites: [H6, M] },
];

const TWO_STAGE =
  "Two-stage (-2s): this filter does the first step up, a lighter one the rest: about the same quality for less CPU, mainly at the highest rates.";

/** A filter's note, or null for a name hqpweb has no sourced note for (a newer HQPlayer). */
export function filterNote(name: string): FilterNote | null {
  const own = ENTRIES.find((e) => e.match(name) && e.line);
  const family = ENTRIES.find((e) => e.match(name) && e.family);
  if (!own) return null; // a family line alone would be a guess about a filter we haven't read about
  const lines = [family?.family, own?.line, phaseOf(name), name.endsWith("-2s") ? TWO_STAGE : undefined].filter(
    (l): l is string => !!l,
  );
  const cites = [...(family?.cites ?? []), ...(own?.cites ?? [])].filter(
    (c, i, all) => all.findIndex((x) => x.label === c.label && x.url === c.url) === i,
  );
  return { lines, cites };
}

/** What 1x and Nx mean, for the (i) on the card's filter rows. */
export const SLOT_NOTE: FilterNote = {
  lines: [
    "HQPlayer has two filter slots. The 1x filter is used for CD-rate sources (44.1 and 48 kHz); the Nx filter for everything higher.",
    "HQPlayer's defaults are poly-sinc-gauss-long for 1x and poly-sinc-gauss-hires-lp for Nx. Past those, Jussi: it's up to your ears; settle the modulator first, then choose filters for the kind of music.",
    "If the Apod counter passes about 10 in a track, an apodizing filter is the technical answer; on clean recordings an apodizing filter does no harm.",
  ],
  cites: [H6, M, J_DEFAULTS, J(FILTERS_2024, "261032/1328", "2026-04")],
};
