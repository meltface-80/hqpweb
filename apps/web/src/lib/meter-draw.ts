// Drawing the meter's views on a canvas (MeterStrip.svelte decides what and when). Colours
// come from the theme's CSS tokens; scales and colour rules from meter-view.ts, tested there.
import { apartFrom, corrX, norm, ramp } from "./meter-view.ts";

type Box = { x: number; w: number };
type Ticks = { x: { label: string; x: number }[]; y: { label: string; y: number }[] };

export const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Size the canvas to its box at the screen's pixel density; draw in CSS pixels. */
export function fit(c: HTMLCanvasElement) {
  const r = c.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * d)) {
    c.width = Math.round(r.width * d);
    c.height = Math.round(r.height * d);
  }
  const g = c.getContext("2d")!;
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
}

/** Faint gridlines, drawn over the bars so they read across them: the frequency ticks, and every 20 dB. */
function grid(g: CanvasRenderingContext2D, w: number, h: number, t: Ticks) {
  g.globalAlpha = 0.45;
  g.fillStyle = css("--text-faint");
  for (const x of t.x) g.fillRect(Math.round(x.x * w), 0, 1, h);
  for (const y of t.y) g.fillRect(0, Math.round(h - y.y * h), w, 1);
  g.globalAlpha = 1;
}

export function bars(c: HTMLCanvasElement, bands: number[], boxes: Box[], t: Ticks) {
  const { g, w, h } = fit(c);
  g.clearRect(0, 0, w, h);
  g.fillStyle = css("--accent");
  bands.forEach((db, i) => {
    const b = boxes[i]!;
    const y = norm(db) * h;
    g.fillRect(b.x * w + 1, h - y, Math.max(1, b.w * w - 2), y);
  });
  grid(g, w, h, t);
}

export function line(c: HTMLCanvasElement, bands: number[], peaks: number[], boxes: Box[], t: Ticks) {
  const { g, w, h } = fit(c);
  g.clearRect(0, 0, w, h);
  grid(g, w, h, t);
  const path = (vals: number[]) => {
    g.beginPath();
    vals.forEach((db, i) => g[i ? "lineTo" : "moveTo"]((boxes[i]!.x + boxes[i]!.w / 2) * w, h - norm(db) * h));
    g.stroke();
  };
  g.lineWidth = 1.5;
  g.setLineDash([3, 3]);
  g.strokeStyle = css("--accent-2");
  path(peaks);
  g.setLineDash([]);
  g.lineWidth = 2.5;
  g.strokeStyle = css("--accent");
  path(bands);
}

/** The strip: left and right, loudness (solid), peak (light) and the highest recent peak (tick). */
export function levels(c: HTMLCanvasElement, lv: number[][]) {
  const { g, w, h } = fit(c);
  g.clearRect(0, 0, w, h);
  const rowH = (h - 4) / 2;
  lv.slice(0, 2).forEach(([pkMax = -120, pk = -120, rms = -120], ch) => {
    const y = ch * (rowH + 4);
    g.fillStyle = css("--border");
    g.fillRect(0, y, w, rowH);
    g.fillStyle = css("--accent-soft");
    g.fillRect(0, y, norm(pk) * w, rowH);
    g.fillStyle = css("--accent");
    g.fillRect(0, y, norm(rms) * w, rowH);
    g.fillStyle = css("--accent-2");
    g.fillRect(norm(pkMax) * w - 1, y, 2, rowH);
  });
}

/** Newest row at the top, scrolling down; colours from the theme (meter-view.ts ramp). */
export function waterfall(c: HTMLCanvasElement, bands: number[], boxes: Box[]) {
  const { g, w, h } = fit(c);
  const d = devicePixelRatio || 1;
  g.drawImage(c, 0, 0, c.width, c.height - 3 * d, 0, 3, w, h - 3); // scroll down 3 px
  const colour = ramp(css("--bg"), css("--accent"), css("--accent-2"));
  bands.forEach((db, i) => {
    g.fillStyle = colour(db);
    g.fillRect(boxes[i]!.x * w, 0, boxes[i]!.w * w + 1, 3);
  });
}

/**
 * Stereo: left grows leftward from the centre and right rightward, low frequencies at the
 * bottom; each side's held peak is a short line that falls back toward the centre.
 */
export function stereo(
  c: HTMLCanvasElement,
  ch: { left: number[]; right: number[]; peakLeft: number[]; peakRight: number[] },
  boxes: Box[],
  t: Ticks,
) {
  const { g, w, h } = fit(c);
  g.clearRect(0, 0, w, h);
  const mid = w / 2;
  const half = mid - 1;
  g.fillStyle = css("--accent");
  boxes.forEach((b, i) => {
    const y = h - (b.x + b.w) * h; // the band's span runs up the plot
    const bh = Math.max(1, b.w * h - 1);
    const l = norm(ch.left[i] ?? -120) * half;
    const r = norm(ch.right[i] ?? -120) * half;
    g.fillRect(mid - l, y, l, bh);
    g.fillRect(mid + 1, y, r, bh);
  });
  g.fillStyle = css("--accent-2");
  boxes.forEach((b, i) => {
    const y = h - (b.x + b.w) * h;
    const bh = Math.max(1, b.w * h - 1);
    g.fillRect(mid - norm(ch.peakLeft[i] ?? -120) * half - 1, y, 2, bh);
    g.fillRect(mid + norm(ch.peakRight[i] ?? -120) * half, y, 2, bh);
  });
  // The centre line, and faint frequency lines across.
  g.globalAlpha = 0.45;
  g.fillStyle = css("--text-faint");
  g.fillRect(Math.round(mid), 0, 1, h);
  for (const x of t.x) g.fillRect(0, Math.round(h - x.x * h), w, 1);
  g.globalAlpha = 1;
}

/**
 * Width: one row per band, low notes at the bottom. A bar runs from the right (mono) to
 * where the band's correlation sits: longer is wider; past the middle, out of phase (red).
 * Quiet bands (below −80 dB) are left out: their correlation means nothing.
 */
export function width(c: HTMLCanvasElement, corr: number[], level: number[], boxes: Box[], t: Ticks) {
  const { g, w, h } = fit(c);
  g.clearRect(0, 0, w, h);
  const red = css("--danger");
  const wide = apartFrom(red, css("--accent"), css("--accent-2"));
  boxes.forEach((b, i) => {
    if ((level[i] ?? -120) < -80 || corr[i] === undefined) return;
    const y = h - (b.x + b.w) * h;
    const bh = Math.max(1, b.w * h - 1);
    const x = corrX(corr[i]!) * w;
    g.fillStyle = corr[i]! < 0 ? red : wide;
    g.fillRect(x, y, w - x, bh);
  });
  g.globalAlpha = 0.45;
  g.fillStyle = css("--text-faint");
  g.fillRect(Math.round(w / 2), 0, 1, h);
  for (const x of t.x) g.fillRect(0, Math.round(h - x.x * h), w, 1);
  g.globalAlpha = 1;
}

/**
 * Dynamics: the last `windowMs` of loudness, newest at the right. RMS as a filled area,
 * peak as a line above it: the gap between them is how much the music swings.
 */
export function dynamics(
  c: HTMLCanvasElement,
  points: { t: number; peak: number; rms: number }[],
  now: number,
  windowMs: number,
  t: Ticks,
) {
  const { g, w, h } = fit(c);
  g.clearRect(0, 0, w, h);
  g.globalAlpha = 0.45;
  g.fillStyle = css("--text-faint");
  for (const y of t.y) g.fillRect(0, Math.round(h - y.y * h), w, 1);
  g.globalAlpha = 1;
  if (points.length < 2) return;
  const x = (tt: number) => w - ((now - tt) / windowMs) * w;
  const y = (db: number) => h - norm(db) * h;
  g.beginPath();
  g.moveTo(x(points[0]!.t), h);
  for (const p of points) g.lineTo(x(p.t), y(p.rms));
  g.lineTo(x(points[points.length - 1]!.t), h);
  g.closePath();
  g.fillStyle = css("--accent");
  g.fill();
  g.beginPath();
  points.forEach((p, i) => g[i ? "lineTo" : "moveTo"](x(p.t), y(p.peak)));
  g.lineWidth = 1.5;
  g.strokeStyle = css("--accent-2");
  g.stroke();
}
