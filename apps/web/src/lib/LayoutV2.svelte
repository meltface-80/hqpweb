<script lang="ts">
  // The layout (docs/design-v2-layout.md): the now card, the signal-path card, History, then
  // presets and the rare switches. Two columns from 900 px (the card on the left, the now card
  // on the right). App's pieces (the now card, filters, shaping, presets) come in as snippets.
  import type { Snippet } from "svelte";
  import SignalCard, { type Resume } from "./SignalCard.svelte";
  import MiniBar from "./MiniBar.svelte";
  import MeterStrip from "./MeterStrip.svelte";
  import CompareSheet from "./CompareSheet.svelte";
  import { healthWord } from "./signal.ts";
  import { knownBad, type Capabilities, type Change, type RoonZone, type Snapshot, type Status } from "./api.ts";
  import type { ResultMessage } from "./result.ts";
  import { nameAt, type rateItems as rateItemsOf } from "./hints.ts";
  import type { SpeedClass } from "./speed.ts";

  let {
    caps,
    snap,
    busy,
    apply,
    rateItems,
    inUseFilter,
    source,
    outRate,
    dacName,
    product,
    resume,
    speedClass,
    speedText,
    nowCard,
    filters,
    shaping,
    below,
    presets,
    onguide,
    onhistory,
    onmetertiming,
    selected,
    roonZone,
    onstatus,
    onmessage,
    switching = null,
  }: {
    caps: Capabilities;
    snap: Snapshot;
    busy: boolean;
    apply: (change: Change) => Promise<unknown>;
    rateItems: ReturnType<typeof rateItemsOf>;
    inUseFilter: string;
    source: number;
    outRate: number;
    dacName?: string;
    product?: string;
    resume: Resume;
    speedClass: SpeedClass;
    speedText: string;
    nowCard: Snippet;
    filters: Snippet;
    shaping: Snippet;
    below: Snippet;
    /** The presets row, joined with Compare and History in one card (owner's review, 2026-10-09). */
    presets?: Snippet;
    onguide: () => void;
    onhistory: () => void;
    /** The meter's "Settings ›": Settings → Listening → Meter timing. */
    onmetertiming: () => void;
    selected: string;
    roonZone: RoonZone | null;
    onstatus: (status: Status) => void;
    onmessage: (m: ResultMessage) => void;
    /** A mode switch to this mode is running (switching.ts): the mini bar holds steady. */
    switching?: string | null;
  } = $props();

  let compare = $state<CompareSheet>();

  // The mini bar: on a narrow screen, once the now card has scrolled out of view.
  let nowEl: HTMLElement;
  let nowVisible = $state(true);
  let narrow = $state(true);
  $effect(() => {
    const io = new IntersectionObserver(([e]) => (nowVisible = !!e?.isIntersecting));
    io.observe(nowEl);
    const mq = matchMedia("(max-width: 899px)");
    narrow = mq.matches;
    const onMq = () => (narrow = mq.matches);
    mq.addEventListener("change", onMq);
    return () => {
      io.disconnect();
      mq.removeEventListener("change", onMq);
    };
  });
  const playing = $derived(snap.status.state === 2);

  /** How often the combination in use has failed here: the rate row flags auto with it. */
  const failedHere = $derived.by(() => {
    const f = knownBad(caps.knownBad, {
      mode: caps.mode.name,
      rateHz: outRate,
      filterNx: nameAt(caps.filters, snap.state.filterNx),
      filter1x: nameAt(caps.filters, snap.state.filter1x),
      shaper: nameAt(caps.shapers, snap.state.shaper),
    });
    return f ? (f.count ?? 1) : 0;
  });
</script>

<div class="v2">
  <div class="v2-now">
    <div bind:this={nowEl}>{@render nowCard()}</div>
    <MeterStrip instanceId={selected} {playing} outputDelayMs={snap.status.outputDelayMs} ontiming={onmetertiming} />
  </div>
  <div class="v2-path">
    <SignalCard
      {caps}
      {snap}
      {busy}
      {apply}
      {rateItems}
      {inUseFilter}
      {source}
      {outRate}
      {dacName}
      {product}
      {resume}
      {failedHere}
      {speedClass}
      {speedText}
      {filters}
      {shaping}
      {onguide}
    />
    <section class="rows">
      <button class="rowbtn" onclick={() => compare?.open()}
        ><span>Compare</span><span class="chev" aria-hidden="true">›</span></button
      >
      <button class="rowbtn" onclick={onhistory}><span>History</span><span class="chev" aria-hidden="true">›</span></button>
      {#if presets}{@render presets()}{/if}
    </section>
    <CompareSheet bind:this={compare} {caps} {snap} {busy} {selected} {apply} />
    {@render below()}
  </div>
</div>
{#if narrow && !nowVisible}
  <MiniBar
    {snap}
    {caps}
    zone={roonZone}
    {selected}
    {busy}
    {apply}
    health={`${healthWord(speedClass, playing)}${playing ? ` ${speedText}` : ""}`}
    healthClass={playing ? speedClass : ""}
    onback={() => nowEl.scrollIntoView({ behavior: "smooth", block: "start" })}
    {onstatus}
    {onmessage}
    {switching}
  />
{/if}

<style>
  /* Compare, History and Presets as rows of one card, like the signal card's rows. */
  .rows {
    margin-top: 10px;
    background: var(--bg-elev);
    border-radius: 14px;
    overflow: hidden;
  }
  /* Dividers between rows: on the buttons themselves, as their own border: 0 would win otherwise. */
  .rowbtn + .rowbtn,
  .rows > :global(* + :not(.rowbtn)) {
    border-top: 1px solid var(--border);
  }
  .rowbtn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    min-height: 48px;
    padding: 12px 16px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .rowbtn .chev {
    color: var(--text-dim);
  }
  @media (min-width: 900px) {
    .v2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }
    .v2-path {
      grid-column: 1;
      grid-row: 1;
    }
    .v2-now {
      grid-column: 2;
      grid-row: 1;
      position: sticky;
      top: 16px;
    }
  }
</style>
