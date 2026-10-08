<script lang="ts">
  // The v2 filter picker (docs/design-v2-layout.md rule 2): a row like today's Picker's,
  // opening a sheet where every filter carries up to four chips, and the chips that would
  // narrow the list are offered as filters (families as drop-downs), with a count. "+n" shows the rest and the
  // why (a ratio it can't play, a failure here). Rules in chips.ts; picking goes through
  // the caller (App's pickFilter: a filter that can't play the ratio offers rates).
  import { tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import Chip from "./Chip.svelte";
  import ChipFacets from "./ChipFacets.svelte";
  import type { KeptUp } from "./api.ts";
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
    onpick,
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
    onpick: (item: Item) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let query = $state("");
  const keys = new SvelteSet<string>();
  let expanded = $state<string | null>(null);

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

  /** Open the sheet; `chips` pre-selects filters, e.g. ["apodizing"] (as Picker.open). */
  export async function open(opts: { chips?: string[] } = {}) {
    keys.clear();
    for (const c of opts.chips ?? []) keys.add(c === "apodizing" ? APODIZING : c);
    query = "";
    expanded = null;
    await tick();
    dialog.showModal();
    dialog.querySelector(".row.current")?.scrollIntoView({ block: "center" });
  }
  function pick(i: Item) {
    dialog.close();
    if (i.name !== current) onpick(i);
  }
</script>

<button class="open" {disabled} onclick={() => open()}>
  <span class="label"
    >{label}{#if inUse}<span class="badge">in use</span>{/if}</span
  >
  <span class="value">{current} ›</span>
</button>

<dialog bind:this={dialog} class="sheet" aria-label="{label}: choose">
  <div class="head">
    <h3>{label}</h3>
    <button class="done" onclick={() => dialog.close()}>Done</button>
  </div>
  <input class="search" type="search" placeholder="Search" aria-label="Search filters" bind:value={query} />
  <ChipFacets {offered} {keys} count="{visible.length} of {rows.length}" />
  <ul>
    {#each visible as r (r.name)}
      {@const s = shown(r.chips)}
      <li class="row" class:current={r.name === current}>
        <button class="pick" onclick={() => pick(r.item)}>
          <span class="name">{r.name}</span>
          {#if r.name === current}<span class="tick" aria-label="selected">✓</span>{/if}
        </button>
        <div class="chips">
          {#each expanded === r.name ? r.chips : s.chips as c (c.key)}<Chip kind={c.kind} label={c.label} />{/each}
          {#if s.more || r.item.blocked || r.item.warn}
            <button
              class="more"
              aria-expanded={expanded === r.name}
              onclick={() => (expanded = expanded === r.name ? null : r.name)}
              >{expanded === r.name ? "less" : s.more ? `+${s.more} · why?` : "why?"}</button
            >
          {/if}
        </div>
        {#if expanded === r.name && (r.item.blocked || r.item.warn)}
          <p class="why">
            {[r.item.blocked && `Can't play this ratio: ${r.item.blocked}.`, r.item.warn].filter(Boolean).join(" ")}
          </p>
        {/if}
      </li>
    {/each}
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
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 6px;
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
</style>
