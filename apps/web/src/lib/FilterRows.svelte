<script lang="ts">
  // The 1x and Nx filter rows: each opens the chip sheet (FilterSheet). The parent gets the one in use back
  // through `picker1x`/`pickerNx`, to open it from elsewhere (the apodizing suggestion,
  // "choose another filter" for a track that can't start).
  import FilterSheet from "./FilterSheet.svelte";
  import { api, type Capabilities, type Change, type Combo, type Snapshot } from "./api.ts";
  import { prefs } from "./prefs.svelte.ts";
  import { sheetFit } from "./fit/sheet.ts";
  import type { filterItems as filterItemsOf } from "./hints.ts";
  import { context, nameAt } from "./hints.ts";

  type Items = ReturnType<typeof filterItemsOf>;
  type Slot = "filter1x" | "filterNx";
  export type Opener = { open: (opts?: { chips?: string[] }) => unknown };

  let {
    instanceId,
    caps,
    snap,
    items1x,
    itemsNx,
    inUse,
    busy,
    outRate,
    onpick,
    onapply,
    onforgot,
    picker1x = $bindable(),
    pickerNx = $bindable(),
  }: {
    instanceId: string;
    caps: Capabilities;
    snap: Snapshot;
    items1x: Items;
    itemsNx: Items;
    inUse: "1x" | "Nx" | null;
    busy: boolean;
    outRate: number;
    onpick: (field: Slot, item: Items[number]) => void;
    /** Several settings at once, from the sheet's "What would it take?". */
    onapply: (change: Change) => void;
    /** After "Forget this": the caller reloads what's been learned (capabilities). */
    onforgot: () => void;
    picker1x?: Opener;
    pickerNx?: Opener;
  } = $props();

  const cur1x = $derived(nameAt(caps.filters, snap.state.filter1x));
  const curNx = $derived(nameAt(caps.filters, snap.state.filterNx));
  const ctx = $derived(prefs.fitSort ? context(caps, snap) : null);
  const forget = (c: Combo) => api.forgetCombo(instanceId, c).then(onforgot, onforgot);
  const fit1x = $derived(ctx && sheetFit(ctx, "1x", prefs.fitMaxAgeDays));
  const fitNx = $derived(ctx && sheetFit(ctx, "Nx", prefs.fitMaxAgeDays));
</script>

<FilterSheet
  bind:this={picker1x}
  label="1x filter"
  slot="1x"
  items={items1x}
  current={cur1x}
  inUse={inUse === "1x"}
  keptUp={caps.keptUp}
  slowSwitches={caps.slowSwitches}
  mode={caps.mode.name}
  rateHz={outRate}
  disabled={busy}
  fit={fit1x}
  {onapply}
  onforget={forget}
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
  slowSwitches={caps.slowSwitches}
  mode={caps.mode.name}
  rateHz={outRate}
  disabled={busy}
  fit={fitNx}
  {onapply}
  onforget={forget}
  onpick={(i) => onpick("filterNx", i as Items[number])}
/>
