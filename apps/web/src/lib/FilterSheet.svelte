<script lang="ts">
  // The v2 filter picker (docs/design-v2-layout.md rule 2): a row like today's Picker's,
  // opening a sheet where every filter carries up to four chips, and the chips that would
  // narrow the list are offered as filters (families as drop-downs), with a count. "+n" shows the rest and the
  // why (a ratio it can't play, a failure here). Rules in chips.ts; picking goes through
  // the caller (App's pickFilter: a filter that can't play the ratio offers rates).
  import { tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import Chip from "./Chip.svelte";
  import FilterNoteView from "./FilterNoteView.svelte";
  import { SLOT_NOTE, filterNote } from "./advice/filter-notes.ts";
  import ChipFacets from "./ChipFacets.svelte";
  import FitPanel from "./FitPanel.svelte";
  import { formatRate, type Change, type Combo, type KeptUp } from "./api.ts";
  import { filterFit, forgettable, tryAnyway, whyNot, type SheetFit } from "./fit/sheet.ts";
  import { APODIZING, facets, filterChips, grouped, keptLowFor, narrow, shown, type FilterItemLike } from "./chips.ts";

  type Item = FilterItemLike & { note?: string; disabled?: boolean };

  let {
    label,
    slot,
    items,
    current,
    inUse,
    keptUp,
    mode,
    rateHz,
    disabled = false,
    fit = null,
    onpick,
    onapply,
    onforget,
  }: {
    label: string;
    slot: "1x" | "Nx";
    items: Item[];
    current: string;
    /** This slot is the one the playing track uses. */
    inUse: boolean;
    keptUp: KeptUp[];
    mode: string;
    rateHz: number;
    disabled?: boolean;
    /** When this slot decides the playback: split the list into fits / won't fit as set (fit/sheet.ts). */
    fit?: SheetFit | null;
    onpick: (item: Item) => void;
    /** Apply a change of several settings at once ("What would it take?"). */
    onapply: (change: Change) => void;
    /** Forget the record behind a filter's trouble ("Forget this"). */
    onforget: (combo: Combo) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let query = $state("");
  const keys = new SvelteSet<string>();
  let expanded = $state<string | null>(null);
  /** The filter whose (i) note is open, and whether the slots' note is. */
  let about = $state<string | null>(null);
  let slotOpen = $state(false);
  const notes = $derived(new Map(items.map((i) => [i.name, filterNote(i.name)])));

  const rows = $derived(
    items.map((i) => ({
      item: i,
      name: i.name,
      chips: filterChips(i, {
        inUse: inUse && i.name === current,
        keptLow: keptLowFor(keptUp, { mode, rateHz, slot, name: i.name }),
      }),
    })),
  );
  // Loose chips, and phase, ratio, focus and length as drop-downs (too many chips for a phone).
  const offered = $derived(grouped(facets(rows.map((r) => r.chips))));
  const visible = $derived(narrow(rows, keys).filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase())));
  // Below the line: why, and only if this slot decides the playback.
  const fits = $derived(new Map(fit ? items.map((i) => [i.name, filterFit(fit, i.name)]) : []));
  const why = $derived(new Map(fit ? items.map((i) => [i.name, whyNot(fit, i.name, fits.get(i.name)!)]) : []));
  const forgets = $derived(new Map([...fits].map(([n, f]) => [n, forgettable(f)])));
  const above = $derived(visible.filter((r) => !why.get(r.name)));
  const below = $derived(visible.filter((r) => why.get(r.name)));
  /** The row asking "Try anyway?", and the row showing "What would it take?". */
  let asking = $state<string | null>(null);
  let taking = $state<string | null>(null);

  /** Open the sheet; `chips` pre-selects filters, e.g. ["apodizing"] (as Picker.open). */
  export async function open(opts: { chips?: string[] } = {}) {
    keys.clear();
    for (const c of opts.chips ?? []) keys.add(c === "apodizing" ? APODIZING : c);
    query = "";
    expanded = null;
    about = null;
    slotOpen = false;
    asking = null;
    taking = null;
    await tick();
    dialog.showModal();
    dialog.querySelector(".row.current")?.scrollIntoView({ block: "center" });
  }
  function pick(i: Item, sure = false) {
    // A ratio it can't do goes to the caller's rate sheet; trouble here asks first.
    if (!sure && !i.blocked && i.name !== current && why.get(i.name)) {
      asking = i.name;
      return;
    }
    dialog.close();
    if (i.name !== current) onpick(i);
  }
  function apply(c: Change) {
    dialog.close();
    onapply(c);
  }
  // Fits as set: the settings it fits with ("ASDM7EC-super at DSD256").
  const asSet = $derived(fit ? `${fit.input.combo.shaper} at ${formatRate(fit.input.combo.rateHz)}` : "");
</script>

<button class="open" {disabled} onclick={() => open()}>
  <span class="label"
    >{label}{#if inUse}<span class="badge">in use</span>{/if}</span
  >
  <span class="value">{current} ›</span>
</button>

<dialog bind:this={dialog} class="sheet" aria-label="{label}: choose">
  <div class="head">
    <h3>
      {label}
      <button
        class="info"
        aria-label="About the 1x and Nx filters"
        aria-expanded={slotOpen}
        onclick={() => (slotOpen = !slotOpen)}
        ><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.1" /></svg
        ></button
      >
    </h3>
    <button class="done" onclick={() => dialog.close()}>Done</button>
  </div>
  {#if slotOpen}<FilterNoteView note={SLOT_NOTE} />{/if}
  <input class="search" type="search" placeholder="Search" aria-label="Search filters" bind:value={query} />
  <ChipFacets {offered} {keys} count="{visible.length} of {rows.length}" />
  {#snippet row(r: (typeof rows)[number])}
    {@const s = shown(r.chips)}
    <li class="row" class:current={r.name === current}>
      <button class="pick" onclick={() => pick(r.item)}>
        <span class="name">{r.name}</span>
        {#if r.name === current}<span class="tick" aria-label="selected">✓</span>{/if}
      </button>
      {#if notes.get(r.name)}
        <button
          class="info"
          aria-label="About {r.name}"
          aria-expanded={about === r.name}
          onclick={() => (about = about === r.name ? null : r.name)}
          ><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.1" /></svg
          ></button
        >
      {/if}
      <div class="chips">
        {#each expanded === r.name ? r.chips : s.chips as c (c.key)}<Chip kind={c.kind} label={c.label} />{/each}
        {#if s.more || ((r.item.blocked || r.item.warn) && !why.get(r.name))}
          <button
            class="more"
            aria-expanded={expanded === r.name}
            onclick={() => (expanded = expanded === r.name ? null : r.name)}
            >{expanded === r.name ? "less" : s.more ? `+${s.more} · why?` : "why?"}</button
          >
        {/if}
      </div>
      {#if about === r.name && notes.get(r.name)}<FilterNoteView note={notes.get(r.name)!} />{/if}
      {#if why.get(r.name)}
        <p class="why">
          {why.get(r.name)}
          {#if forgets.get(r.name)}<button class="forget" onclick={() => onforget(forgets.get(r.name)!)}>Forget this</button>{/if}
        </p>
        {#if asking === r.name}
          <div class="ask" role="alertdialog" aria-label="Try {r.name} anyway?">
            <p>{tryAnyway(why.get(r.name)!)}</p>
            <button class="yes" onclick={() => pick(r.item, true)}>Try</button>
            <button onclick={() => (asking = null)}>Cancel</button>
          </div>
        {/if}
        <button class="take" aria-expanded={taking === r.name} onclick={() => (taking = taking === r.name ? null : r.name)}
          >What would it take?</button
        >
        {#if taking === r.name && fit}<FitPanel sheet={fit} name={r.name} onapply={apply} />{/if}
      {:else if expanded === r.name && (r.item.blocked || r.item.warn)}
        <p class="why">
          {[r.item.blocked && `Can't play this ratio: ${r.item.blocked}.`, r.item.warn].filter(Boolean).join(" ")}
        </p>
      {/if}
    </li>
  {/snippet}
  <ul>
    {#if fit && below.length}<li class="section">Fits as set ({asSet})</li>{/if}
    {#each above as r (r.name)}{@render row(r)}{/each}
    {#if below.length}<li class="section">Won't fit as set</li>{/if}
    {#each below as r (r.name)}{@render row(r)}{/each}
  </ul>
</dialog>

<style>
  .open {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 48px;
    padding: 10px 16px;
    border: 0;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .label {
    flex: none;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .badge {
    font-size: 0.7rem;
    padding: 2px 7px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .value {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    overflow-wrap: anywhere;
    text-align: right;
  }
  .sheet {
    border: 0;
    border-radius: 18px;
    padding: 16px;
    width: min(32rem, 100vw - 24px);
    max-height: 88vh;
    background: var(--bg-elev);
    color: var(--text);
  }
  .sheet::backdrop {
    background: var(--bg-veil);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h3 {
    margin: 0;
  }
  .done {
    font: inherit;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    margin: 12px 0 8px;
    min-height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .row {
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .row.current {
    background: var(--accent-soft);
    margin: 0 -16px;
    padding: 8px 16px;
  }
  .pick {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 40px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 500;
  }
  .tick {
    color: var(--ok);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .more {
    font: inherit;
    font-size: 0.75rem;
    border: 0;
    background: none;
    color: var(--accent-text);
    cursor: pointer;
    min-height: 32px;
    padding: 0 4px;
  }
  .why {
    margin: 6px 0 0;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .row {
    position: relative;
  }
  .info {
    position: absolute;
    right: 0;
    top: 10px;
    width: 32px;
    height: 32px;
    padding: 4px;
    border: 0;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
  }
  .info[aria-expanded="true"] {
    color: var(--accent-text);
  }
  .info svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .row .pick {
    padding-right: 36px;
  }
  .section {
    padding: 14px 0 4px;
    font-size: 0.78rem;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
  }
  .forget {
    font: inherit;
    font-size: 0.78rem;
    border: 0;
    background: none;
    color: var(--text-faint);
    text-decoration: underline;
    cursor: pointer;
    padding: 0 0 0 4px;
  }
  .take {
    font: inherit;
    font-size: 0.8rem;
    border: 0;
    background: none;
    color: var(--accent-text);
    cursor: pointer;
    min-height: 32px;
    padding: 0;
  }
  .ask {
    margin: 6px 0;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--warn);
    background: var(--bg);
  }
  .ask p {
    margin: 0 0 8px;
    font-size: 0.85rem;
  }
  .ask button {
    font: inherit;
    min-height: 36px;
    padding: 0 14px;
    margin-right: 8px;
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text);
    cursor: pointer;
  }
  .ask .yes {
    color: var(--accent-text);
  }
  h3 .info {
    position: static;
    vertical-align: middle;
  }
</style>
