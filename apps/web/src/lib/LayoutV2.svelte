<script lang="ts">
  // The v2 layout (docs/design-v2-layout.md), a preview switched on in Settings: the
  // now card, the signal-path card, History, then presets and the rare switches. Two
  // columns from 900 px (the card on the left, the now card on the right). The pieces
  // App shares with the current layout come in as snippets.
  import type { Snippet } from "svelte";
  import SignalCard, { type Resume } from "./SignalCard.svelte";
  import MiniBar from "./MiniBar.svelte";
  import MeterStrip from "./MeterStrip.svelte";
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
    resume,
    speedClass,
    speedText,
    nowCard,
    filters,
    shaping,
    below,
    onguide,
    onhistory,
    selected,
    roonZone,
    onstatus,
    onmessage,
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
    resume: Resume;
    speedClass: SpeedClass;
    speedText: string;
    nowCard: Snippet;
    filters: Snippet;
    shaping: Snippet;
    below: Snippet;
    onguide: () => void;
    onhistory: () => void;
    selected: string;
    roonZone: RoonZone | null;
    onstatus: (status: Status) => void;
    onmessage: (m: ResultMessage) => void;
  } = $props();

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
    <MeterStrip instanceId={selected} {playing} />
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
      {resume}
      {failedHere}
      {speedClass}
      {speedText}
      {filters}
      {shaping}
      {onguide}
    />
    <div class="actions"><button class="action" onclick={onhistory}>History</button></div>
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
  />
{/if}

<style>
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 10px;
  }
  .action {
    flex: 1;
    font: inherit;
    font-weight: 600;
    min-height: 48px;
    border-radius: 24px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text);
    cursor: pointer;
  }
  @media (min-width: 900px) {
    :global(main.wide) {
      max-width: 72rem;
    }
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
