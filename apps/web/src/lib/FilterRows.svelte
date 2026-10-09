<script lang="ts">
  // The 1x and Nx filter rows, shared by both layouts: today's Picker in the current
  // layout, the chip sheet (FilterSheet) in v2. The parent gets the one in use back
  // through `picker1x`/`pickerNx`, to open it from elsewhere (the apodizing suggestion,
  // "choose another filter" for a track that can't start).
  import Picker from "./Picker.svelte";
  import FilterSheet from "./FilterSheet.svelte";
  import type { Capabilities, Change, Snapshot } from "./api.ts";
  import { sheetFit } from "./fit/sheet.ts";
  import type { filterItems as filterItemsOf } from "./hints.ts";
  import { context, nameAt } from "./hints.ts";

  type Items = ReturnType<typeof filterItemsOf>;
  type Slot = "filter1x" | "filterNx";
  export type Opener = { open: (opts?: { chips?: string[] }) => unknown };

  let {
    caps,
    snap,
    items1x,
    itemsNx,
    inUse,
    taken1x,
    takenNx,
    ratioLabel,
    busy,
    v2,
    groupByRating,
    outRate,
    onpick,
    onapply,
    picker1x = $bindable(),
    pickerNx = $bindable(),
  }: {
    caps: Capabilities;
    snap: Snapshot;
    items1x: Items;
    itemsNx: Items;
    inUse: "1x" | "Nx" | null;
    taken1x: boolean | null;
    takenNx: boolean | null;
    ratioLabel: string;
    busy: boolean;
    v2: boolean;
    groupByRating: boolean;
    outRate: number;
    onpick: (field: Slot, item: Items[number]) => void;
    /** Several settings at once, from the sheet's "What would it take?". */
    onapply: (change: Change) => void;
    picker1x?: Opener;
    pickerNx?: Opener;
  } = $props();

  const cur1x = $derived(nameAt(caps.filters, snap.state.filter1x));
  const curNx = $derived(nameAt(caps.filters, snap.state.filterNx));
  const ctx = $derived(v2 ? context(caps, snap) : null);
  const fit1x = $derived(ctx && sheetFit(ctx, "1x"));
  const fitNx = $derived(ctx && sheetFit(ctx, "Nx"));
</script>

{#if v2}
  <FilterSheet
    bind:this={picker1x}
    label="1x filter"
    slot="1x"
    items={items1x}
    current={cur1x}
    inUse={inUse === "1x"}
    keptUp={caps.keptUp}
    mode={caps.mode.name}
    rateHz={outRate}
    disabled={busy}
    fit={fit1x}
    {onapply}
    onpick={(i) => onpick("filter1x", i as Items[number])}
  />
  <FilterSheet
    bind:this={pickerNx}
    label="Nx filter"
    slot="Nx"
    items={itemsNx}
    current={curNx}
    inUse={inUse === "Nx"}
    keptUp={caps.keptUp}
    mode={caps.mode.name}
    rateHz={outRate}
    disabled={busy}
    fit={fitNx}
    {onapply}
    onpick={(i) => onpick("filterNx", i as Items[number])}
  />
{:else}
  <Picker
    bind:this={picker1x}
    label="1x filter"
    hint={inUse === "1x" ? "in use" : ""}
    active={taken1x}
    items={items1x}
    {groupByRating}
    current={cur1x}
    disabled={busy}
    {ratioLabel}
    onpick={(i) => onpick("filter1x", i as Items[number])}
  />
  <Picker
    bind:this={pickerNx}
    label="Nx filter"
    hint={inUse === "Nx" ? "in use" : ""}
    active={takenNx}
    items={itemsNx}
    {groupByRating}
    current={curNx}
    disabled={busy}
    {ratioLabel}
    onpick={(i) => onpick("filterNx", i as Items[number])}
  />
{/if}
