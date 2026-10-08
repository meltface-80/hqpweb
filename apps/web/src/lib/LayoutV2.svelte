<script lang="ts">
  // The v2 layout (docs/design-v2-layout.md), a preview switched on in Settings: the
  // now card, the signal-path card, History, then presets and the rare switches. Two
  // columns from 900 px (the card on the left, the now card on the right). The pieces
  // App shares with the current layout come in as snippets.
  import type { Snippet } from "svelte";
  import SignalCard, { type Resume } from "./SignalCard.svelte";
  import { knownBad, type Capabilities, type Change, type Snapshot } from "./api.ts";
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
  } = $props();

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
  <div class="v2-now">{@render nowCard()}</div>
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
