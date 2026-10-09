<script lang="ts">
  // The v2 meter (docs/design-v2-layout.md rule 9): a strip under the now card that says it
  // opens, and the open square with its views. Data from the server's meter stream (paced,
  // condensed: meter-stream.ts); drawing rules in meter-view.ts. It only connects while shown.
  import { api, type MeterEvent } from "./api.ts";
  import {
    bandBoxes,
    crest,
    dbTicks,
    DynHistory,
    freqTicks,
    meterNote,
    mono,
    PeakHold,
    peakRows,
    peakWords,
    Smoother,
  } from "./meter-view.ts";
  import { bars, dynamics, fit, levels, line, stereo, waterfall, width } from "./meter-draw.ts";

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

  // Owner's order (2026-10-08): waterfall first, then line, then bars.
  const VIEWS = [
    { id: "waterfall", label: "Waterfall" },
    { id: "line", label: "Line" },
    { id: "bars", label: "Bars" },
    { id: "stereo", label: "Stereo" },
    { id: "width", label: "Width" },
    { id: "dynamics", label: "Dynamics" },
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
  const holdLeft = new PeakHold();
  const holdRight = new PeakHold();
  const corr = new Smoother();
  const DYN_MS = 30_000;
  const dyn = new DynHistory(DYN_MS);
  let crestDb = $state<number | null>(null);
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
      const now = performance.now();
      const [left, right] = [e.bands[0]!, e.bands[1] ?? e.bands[0]!]; // a mono source: both sides alike
      hold.update(m, now);
      holdLeft.update(left, now);
      holdRight.update(right, now);
      if (e.corr) corr.update(e.corr);
      dyn.push(now, e.levels);
      crestDb = crest(dyn.points);
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
      const ticks = { x: xTicks, y: yTicks };
      if (view === "bars") bars(big, m, boxes, ticks);
      else if (view === "line") line(big, m, hold.values, boxes, ticks);
      else if (view === "stereo")
        stereo(big, { left, right, peakLeft: holdLeft.values, peakRight: holdRight.values }, boxes, ticks);
      else if (view === "width") width(big, corr.values, m, boxes, ticks);
      else if (view === "dynamics") dynamics(big, dyn.points, now, DYN_MS, ticks);
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
  const rows = $derived(shown?.live ? peakRows(shown.levels) : []);
  const nowLabel = $derived(crestDb === null ? "now" : `now · crest ${crestDb.toFixed(1)} dB`);
  const bufferNote = $derived(
    outputDelayMs != null ? ` (HQPlayer reports ${(outputDelayMs / 1000).toFixed(1)} s of output buffer)` : "",
  );
  const VIEW_NOTES: Record<View, string> = {
    bars: "Each bar is the loudest frequency in its band, as it plays (no averaging).",
    line: "The line is each band as it plays; the dashed line its peak, held 1.5 s, then falling.",
    waterfall: "Newest at the top; quiet fades into the background, louder runs through the accent to the second colour.",
    stereo:
      "Left grows to the left, right to the right, low notes at the bottom; the short lines are each side's peak, held, then falling back.",
    width:
      "How alike left and right are in each band, low notes at the bottom: no bar is mono, a long bar wide; past the middle, in red, the sides are out of phase. Quiet bands are left out.",
    dynamics:
      "The last 30 s: the filled area is loudness (RMS), the line the peaks. The gap is the crest factor: small for compressed music, large for dynamic.",
  };
</script>

<section class="meter" class:quiet={!latest.connected} aria-label="Meter">
  {#if !latest.connected}
    <!-- No stream: one line, not a card with a control that opens onto nothing. -->
    <p class="nometer">No meter from this HQPlayer: hqpweb can't connect to its meter port (the control port + 1).</p>
  {:else}
    <button class="strip" aria-expanded={open} aria-label={open ? "Close the meter" : "Open the meter"} onclick={toggle}>
      {#if note}<span class="note">{note}</span>{:else}<canvas bind:this={mini} class="mini" aria-hidden="true"></canvas>
        <span class="peak" title="Peak, dB"
          >{#each rows as r (r)}<span>{r}</span>{/each}</span
        >{/if}
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
            {#if view === "stereo" || view === "width"}
              <!-- Frequency runs up the plot in Stereo and Width; the gutter labels it. -->
              {#each xTicks.filter((t) => t.x > 0.02) as t (t.label)}<span style="bottom: {t.x * 100}%">{t.label}</span>{/each}
            {:else if view !== "waterfall"}
              <!-- dB: Line, Bars and Dynamics. -->
              {#each yTicks as t (t.label)}<span style="bottom: {t.y * 100}%">{t.label}</span>{/each}
            {/if}
          </div>
          <div class="axis" aria-hidden="true">
            {#if view === "stereo"}
              <span style="left: 0%">L</span><span style="left: 100%">R</span>
            {:else if view === "width"}
              <span style="left: 0%">out of phase</span><span style="left: 50%">wide</span><span style="left: 100%">mono</span>
            {:else if view === "dynamics"}
              <span style="left: 0%">30 s ago</span><span style="left: 100%">{nowLabel}</span>
            {:else}
              {#each xTicks as t (t.label)}<span style="left: {t.x * 100}%">{t.label}</span>{/each}
            {/if}
          </div>
        </div>
        <p class="sr">{peaks || "No levels yet"}</p>
        <p class="scale" id="meter-about" hidden={!about}>
          {VIEW_NOTES[view]} The strip above: left over right; solid is loudness (RMS), light is peak, the tick the highest recent peak;
          the numbers beside it are each side's peak in dB. All of it is the music before upsampling, after HQPlayer's volume.
        </p>
        <p class="scale timing" hidden={!about}>
          Timing: the meter waits {(delay / 1000).toFixed(1)} s to line up with what you hear{bufferNote}. Your DAC and network
          add their own, so set it by ear:
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
  /* One reading per row, beside the strip's left and right bars. */
  .peak {
    flex: none;
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    line-height: 1.25;
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
