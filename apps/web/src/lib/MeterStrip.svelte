<script lang="ts">
  // The v2 meter (docs/design-v2-layout.md rule 9): a strip under the now card that says it
  // opens, and the open square with its views. Data from the server's meter stream (paced,
  // condensed: meter-stream.ts); drawing rules in meter-view.ts. It only connects while shown.
  import { api, type MeterEvent } from "./api.ts";
  import { bandBoxes, heat, meterNote, mono, norm, PeakHold } from "./meter-view.ts";

  type Box = { x: number; w: number };
  import { prefs, savePrefs } from "./prefs.svelte.ts";

  let { instanceId, playing }: { instanceId: string; playing: boolean } = $props();

  const VIEWS = [
    { id: "bars", label: "Bars" },
    { id: "line", label: "Line" },
    { id: "waterfall", label: "Waterfall" },
  ] as const;

  let latest = $state<MeterEvent>({ live: false, connected: true });
  let open = $state(prefs.meterOpen);
  // Levels moved to the strip (owner's feedback, 2026-10-08): an old stored choice of it opens Bars.
  type View = (typeof VIEWS)[number]["id"];
  const stored = VIEWS.find((v) => v.id === prefs.meterView)?.id;
  let view = $state<View>(stored ?? "bars");
  let mini: HTMLCanvasElement | undefined = $state();
  let big: HTMLCanvasElement | undefined = $state();
  const hold = new PeakHold();
  let fresh = false;
  /** The view last drawn on the big canvas. */
  let drawn: string | null = null;

  $effect(() => {
    const es = api.meter(instanceId);
    es.addEventListener("meter", (e) => {
      latest = JSON.parse((e as MessageEvent).data) as MeterEvent;
      fresh = true;
    });
    return () => es.close();
  });

  function toggle() {
    open = !open;
    drawn = null; // the canvas is new when it opens
    prefs.meterOpen = open;
    savePrefs();
  }
  function pick(v: typeof view) {
    view = v;
    prefs.meterView = v;
    savePrefs();
  }

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function fit(c: HTMLCanvasElement) {
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
  function bars(c: HTMLCanvasElement, bands: number[], boxes: Box[]) {
    const { g, w, h } = fit(c);
    g.clearRect(0, 0, w, h);
    g.fillStyle = css("--accent");
    bands.forEach((db, i) => {
      const b = boxes[i]!;
      const y = norm(db) * h;
      g.fillRect(b.x * w + 1, h - y, Math.max(1, b.w * w - 2), y);
    });
  }
  function line(c: HTMLCanvasElement, bands: number[], peaks: number[], boxes: Box[]) {
    const { g, w, h } = fit(c);
    g.clearRect(0, 0, w, h);
    const path = (vals: number[]) => {
      g.beginPath();
      vals.forEach((db, i) => g[i ? "lineTo" : "moveTo"]((boxes[i]!.x + boxes[i]!.w / 2) * w, h - norm(db) * h));
      g.stroke();
    };
    g.lineWidth = 1.5;
    g.setLineDash([3, 3]);
    g.strokeStyle = css("--warn");
    path(peaks);
    g.setLineDash([]);
    g.lineWidth = 2.5;
    g.strokeStyle = css("--accent");
    path(bands);
  }
  /** The strip: left and right, loudness (solid), peak (light) and the highest recent peak (tick). */
  function levels(c: HTMLCanvasElement, lv: number[][]) {
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
      g.fillStyle = css("--warn");
      g.fillRect(norm(pkMax) * w - 1, y, 2, rowH);
    });
  }
  function waterfall(c: HTMLCanvasElement, bands: number[], boxes: Box[]) {
    const { g, w, h } = fit(c);
    const d = devicePixelRatio || 1;
    g.drawImage(c, 0, 0, c.width, c.height - 3 * d, 0, 3, w, h - 3); // scroll down 3 px
    bands.forEach((db, i) => {
      g.fillStyle = heat(db);
      g.fillRect(boxes[i]!.x * w, 0, boxes[i]!.w * w + 1, 3);
    });
  }

  // Draw only when a new update arrived (~20 a second), on the next frame.
  $effect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!fresh) return;
      fresh = false;
      const e = latest;
      if (!e.live || !e.bands || !e.levels) return;
      const m = mono(e.bands);
      hold.update(m, performance.now());
      if (mini) levels(mini, e.levels);
      if (!big || !open) return;
      // A new view starts clean: the waterfall scrolls whatever is on the canvas.
      if (drawn !== view) {
        const { g, w, h } = fit(big);
        g.clearRect(0, 0, w, h);
        drawn = view;
      }
      // Bands placed by their real frequency span (the server sends the edges in Hz).
      const boxes = bandBoxes(e.edgesHz ?? m.map((_, i) => 20 * 1000 ** (i / m.length)).concat(20_000), 1);
      if (view === "bars") bars(big, m, boxes);
      else if (view === "line") line(big, m, hold.values, boxes);
      else waterfall(big, m, boxes);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  const note = $derived(meterNote(latest, playing));
  const fmt = (v: number | undefined) => (v === undefined || v <= -120 ? "—" : `${v.toFixed(1)} dB`);
  const peaks = $derived(latest.live && latest.levels ? latest.levels.map((l) => fmt(l[1])) : []);
</script>

<section class="meter" aria-label="Meter">
  <button class="strip" aria-expanded={open} aria-label={open ? "Close the meter" : "Open the meter"} onclick={toggle}>
    {#if note}<span class="note">{note}</span>{:else}<canvas bind:this={mini} class="mini" aria-hidden="true"></canvas>
      <span class="peak" title="Peak, left and right">{peaks.join(" · ")}</span>{/if}
    <span class="label"
      >Meter <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"
        >{#if open}<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />{:else}<path
            d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
          />{/if}</svg
      ></span
    >
  </button>
  {#if open}
    <div class="views" role="group" aria-label="Meter view">
      {#each VIEWS as v (v.id)}
        <button aria-pressed={view === v.id} class:on={view === v.id} onclick={() => pick(v.id)}>{v.label}</button>
      {/each}
    </div>
    {#if note}
      <p class="empty">{note}</p>
    {:else}
      <canvas bind:this={big} class="big" aria-hidden="true"></canvas>
      <p class="sr">Peak levels: {peaks.join(", ") || "none yet"}</p>
      <p class="scale">20 Hz · 200 · 2k · 20 kHz · the music as HQPlayer receives it, before upsampling</p>
    {/if}
  {/if}
</section>

<style>
  .meter {
    margin-top: 10px;
    background: var(--bg-elev);
    border-radius: 14px;
    padding: 10px 12px;
  }
  .strip {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 6px 8px;
    border-radius: 10px;
    border: 1px solid var(--accent-soft);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .mini {
    flex: 1;
    height: 28px;
    min-width: 0;
  }
  .note {
    flex: 1;
    text-align: left;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .peak {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent-text);
    white-space: nowrap;
  }
  .views {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 10px 0 8px;
  }
  .views button {
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .views button.on {
    background: var(--text);
    color: var(--bg);
  }
  .big {
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    max-height: 340px;
    border-radius: 10px;
    background: var(--bg);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .scale,
  .empty {
    margin: 6px 0 0;
    font-size: 0.75rem;
    color: var(--text-dim);
  }
  .empty {
    padding: 24px 0;
    text-align: center;
    font-size: 0.85rem;
  }
</style>
