// Per-device preferences, kept in this browser only. Storage may be unavailable
// (private mode, blocked site data), so every access is guarded and the app
// works with the defaults.

export const THEMES = [
  { id: "system", label: "Match system", note: "Dark or light, following this device", theme: null, palette: "classic" },
  { id: "dark", label: "Dark", note: "Cool grey, cyan and coral", theme: "dark", palette: "classic" },
  { id: "light", label: "Light", note: "Bright and neutral, blue and magenta", theme: "light", palette: "classic" },
  { id: "copper-dark", label: "Copper dark", note: "Charcoal, copper and teal", theme: "dark", palette: "copper" },
  { id: "brass-light", label: "Brass light", note: "Warm parchment, brass and deep teal", theme: "light", palette: "copper" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

export interface Prefs {
  theme: ThemeId;
  /** dB per tap of the volume buttons. */
  volumeStep: 0.5 | 1 | 2;
  advancedOpen: boolean;
  /** Filter lists: HQPlayer's own order, or grouped by HQPlayer 6's rating. */
  filterOrder: "hqplayer" | "rating";
  /** The v2 filter sheet sorts by what's worked here: "Won't fit as set" below, asking first (fit/). */
  fitSort: boolean;
  /** Load results older than this many days are ignored by that sort; null: never (fit/evidence.ts). */
  fitMaxAgeDays: number | null;
  /** The modulator/dither sheet opens on the tab used last. */
  adviceTab: "list" | "guide";
  /** The guide's intro has been read once: show it as one line from then on. */
  guideIntroSeen: boolean;
  /** The v2 layout (docs/design-v2-layout.md), a preview until it replaces the current one. */
  layout: "current" | "v2";
  /** The v2 meter: open as a square, and which view. */
  meterOpen: boolean;
  /** "levels" was a view before it moved to the strip; MeterStrip opens Bars for it. */
  meterView: "bars" | "line" | "levels" | "waterfall" | "stereo" | "width" | "dynamics";
  /** The meter's timing nudge per HQPlayer, in ms, set by ear (meter-delay.ts). */
  meterNudge: Record<string, number>;
}

const KEY = "prefs-v1";
const DEFAULTS: Prefs = {
  theme: "system",
  volumeStep: 1,
  advancedOpen: false,
  filterOrder: "hqplayer",
  fitSort: true,
  fitMaxAgeDays: 90,
  adviceTab: "list",
  guideIntroSeen: false,
  layout: "current",
  meterOpen: false,
  meterView: "waterfall",
  meterNudge: {},
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export const prefs: Prefs = $state(load());

export function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
  applyTheme();
}

const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

/** Set data-theme / data-palette on <html>, resolving "Match system". */
export function applyTheme() {
  const t = THEMES.find((x) => x.id === prefs.theme) ?? THEMES[0];
  const family = t.theme ?? (dark?.matches === false ? "light" : "dark");
  document.documentElement.dataset.theme = family;
  document.documentElement.dataset.palette = t.palette;
  const color = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

dark?.addEventListener("change", () => {
  if (prefs.theme === "system") applyTheme();
});
