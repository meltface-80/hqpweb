<script lang="ts">
  // The v2 meter (docs/design-v2-layout.md rule 9): a strip under the now card that says it
  // opens, and the open square with its views. Data from the server's meter stream (paced,
  // condensed: meter-stream.ts); drawing rules in meter-view.ts. It only connects while shown.
  import { api, type MeterEvent } from "./api.ts";
  import { bandBoxes, dbTicks, freqTicks, heat, meterNote, mono, norm, PeakHold, peakWords } from "./meter-view.ts";

  type Box = { x: number; w: number };
  import { prefs, savePrefs } from "./prefs.svelte.ts";
  import { DelayLine, NUDGE_STEP_MS, clampNudge, meterDelayMs } from "./meter-delay.ts";

  let {
    instanceId,
    playing,
    outputDelayMs = null,
  }: {
    instanceId: string;
    playing: boolean;
    /** HQPlayer's reported output buffering (Status), for holding the meter back to match the room. */
    outputDelayMs?: number | null;
  } = $props();

  const VIEWS = [
    { id: "bars", label: "Bars" },
    { id: "line", label: "Line" },
    { id: "waterfall", label: "Waterfall" },
  ] as const;

  let latest = $state<MeterEvent>({ live: false, connected: true });
  let open = $state(prefs.meterOpen);
  /** The captions, shown on (i): the chart stays uncluttered (owner's call). */
  let about = $state(false);
  // Levels moved to the strip (owner's feedback, 2026-10-08): an old stored choice of it opens Bars.
  type View = (typeof VIEWS)[number]["id"];
  const stored = VIEWS.find((v) => v.id === prefs.meterView)?.id;
  let view = $state<View>(stored ?? "bars");
  let mini: HTMLCanvasElement | undefined = $state();
  let big: HTMLCanvasElement | undefined = $state();
  const hold = new PeakHold();
  // Each update waits until it lines up with what's heard (meter-delay.ts); `latest` is the
  // newest received (connection and quiet notes), `shown` the one drawn.
  const pending = new DelayLine<MeterEvent>();
  let shown = $state<MeterEvent | null>(null);
  const nudge = $derived(prefs.meterNudge[instanceId] ?? 0);
  const delay = $derived(meterDelayMs(outputDelayMs, nudge));
  function setNudge(ms: number | null) {
    const next = { ...prefs.meterNudge };
    if (ms === null) delete next[instanceId];
    else next[instanceId] = clampNudge(ms);
    prefs.meterNudge = next;
    savePrefs();
  }
  /** The view last drawn on the big canvas. */
  let drawn: string | null = null;

  $effect(() => {
    const es = api.meter(instanceId);
    es.addEventListener("meter", (e) => {
      latest = JSON.parse((e as MessageEvent).data) as MeterEvent;
      pending.push(performance.now(), latest);
    });
    return () => {
      es.close();
      pending.clear();
    };
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
  /** Faint gridlines: the frequency ticks, and every 20 dB. */
  /** Drawn over the bars, faint, so it reads across them. */
  function grid(g: CanvasRenderingContext2D, w: number, h: number) {
    g.globalAlpha = 0.45;
    g.fillStyle = css("--text-faint");
    for (const t of xTicks) g.fillRect(Math.round(t.x * w), 0, 1, h);
    for (const t of yTicks) g.fillRect(0, Math.round(h - t.y * h), w, 1);
    g.globalAlpha = 1;
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
    grid(g, w, h);
  }
  function line(c: HTMLCanvasElement, bands: number[], peaks: number[], boxes: Box[]) {
    const { g, w, h } = fit(c);
    g.clearRect(0, 0, w, h);
    grid(g, w, h);
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
      const e = pending.take(performance.now(), delay);
      if (!e) return;
      shown = e;
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
      const boxes = bandBoxes(edges(e, m.length), 1);
      if (view === "bars") bars(big, m, boxes);
      else if (view === "line") line(big, m, hold.values, boxes);
      else waterfall(big, m, boxes);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  /** Band edges in Hz from the server; evenly spaced on the log scale if it sent none. */
  const edges = (e: MeterEvent, n: number) => e.edgesHz ?? Array.from({ length: n + 1 }, (_, i) => 20 * 1000 ** (i / n));
  const xTicks = $derived(freqTicks(latest.edgesHz ?? [20, 20_000]));
  const yTicks = dbTicks();
  const note = $derived(meterNote(latest, playing));
  const peaks = $derived(shown?.live ? peakWords(shown.levels) : "");
  const VIEW_NOTES: Record<View, string> = {
    bars: "Each bar is the loudest frequency in its band, as it plays (no averaging).",
    line: "The line is each band as it plays; the dashed line its peak, held 1.5 s, then falling.",
    waterfall: "Newest at the top; brighter is louder.",
  };
</script>

<section class="meter" class:quiet={!latest.connected} aria-label="Meter">
  {#if !latest.connected}
    <!-- No stream: one line, not a card with a control that opens onto nothing. -->
    <p class="nometer">No meter from this HQPlayer: hqpweb can't connect to its meter port (the control port + 1).</p>
  {:else}
    <button class="strip" aria-expanded={open} aria-label={open ? "Close the meter" : "Open the meter"} onclick={toggle}>
      {#if note}<span class="note">{note}</span>{:else}<canvas bind:this={mini} class="mini" aria-hidden="true"></canvas>
        <span class="peak">{peaks}</span>{/if}
      <span class="label"
        >Meter <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          aria-hidden="true"><path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} /></svg
        ></span
      >
    </button>
    {#if open}
      <div class="views" role="group" aria-label="Meter view">
        {#each VIEWS as v (v.id)}
          <button aria-pressed={view === v.id} class:on={view === v.id} onclick={() => pick(v.id)}>{v.label}</button>
        {/each}
        <button
          class="info"
          aria-label="About this meter"
          aria-expanded={about}
          aria-controls="meter-about"
          onclick={() => (about = !about)}>i</button
        >
      </div>
      {#if note}
        <p class="empty">{note}</p>
      {:else}
        <!-- The dB scale sits in a gutter beside the plot, so it never covers the top bands. -->
        <div class="plot">
          <canvas bind:this={big} class="big" aria-hidden="true"></canvas>
          <div class="dbs" aria-hidden="true">
            {#if view !== "waterfall"}
              {#each yTicks as t (t.label)}<span style="bottom: {t.y * 100}%">{t.label}</span>{/each}
            {/if}
          </div>
          <div class="axis" aria-hidden="true">
            {#each xTicks as t (t.label)}<span style="left: {t.x * 100}%">{t.label}</span>{/each}
          </div>
        </div>
        <p class="sr">{peaks || "No levels yet"}</p>
        <p class="scale" id="meter-about" hidden={!about}>
          {VIEW_NOTES[view]} The strip above: left over right; solid is loudness (RMS), light is peak, the tick the highest recent peak.
          All of it is the music before upsampling, after HQPlayer's volume.
        </p>
        <p class="scale timing" hidden={!about}>
          Timing: the meter waits {(delay / 1000).toFixed(1)} s to line up with what you hear{#if outputDelayMs != null}
            (HQPlayer reports {(outputDelayMs / 1000).toFixed(1)} s of output buffer){/if}. Your DAC and network add their own, so
          set it by ear:
          <span class="nudge">
            <button aria-label="Meter earlier" onclick={() => setNudge(nudge - NUDGE_STEP_MS)}>Earlier</button>
            <button aria-label="Meter later" onclick={() => setNudge(nudge + NUDGE_STEP_MS)}>Later</button>
            {#if nudge}<button onclick={() => setNudge(null)}>Auto</button>
              <span class="by">{nudge > 0 ? "+" : "−"}{Math.abs(nudge / 1000).toFixed(1)} s</span>{/if}
          </span>
        </p>
      {/if}
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
  .meter.quiet {
    background: none;
    padding: 0 4px;
  }
  .nometer {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-dim);
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
  /* width 0 + flex: the canvas's own pixel width must not size it (it pushed Meter out). */
  .mini {
    flex: 1 1 0;
    width: 0;
    height: 28px;
    min-width: 72px;
  }
  .note {
    flex: 1;
    text-align: left;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  /* In a narrow column (320 px) the words give way, never the bars or the Meter toggle. */
  .peak {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .label {
    flex: none;
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
  .nudge {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .nudge button {
    font: inherit;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .nudge .by {
    font-family: var(--font-mono);
  }
  .views .info {
    margin-left: auto;
    width: 36px;
    padding: 0;
    font-family: Georgia, serif;
    font-style: italic;
  }
  .views .info[aria-expanded="true"] {
    background: var(--accent-soft);
    color: var(--accent-text);
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
  .plot {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 2.6rem;
    column-gap: 4px;
  }
  .dbs {
    position: relative;
  }
  .dbs span {
    position: absolute;
    left: 0;
    transform: translateY(50%);
    font-size: 0.65rem;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .dbs span:first-child {
    transform: translateY(100%);
  }
  .axis {
    grid-column: 1;
    position: relative;
    height: 1.1rem;
    margin-top: 2px;
    font-size: 0.7rem;
    color: var(--text-dim);
  }
  .axis span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .axis span:first-child {
    transform: none;
  }
  .axis span:last-child {
    transform: translateX(-100%);
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
