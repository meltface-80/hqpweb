<script lang="ts">
  // The modulator or dither list in the v2 layout (docs/design-v2-layout.md rule 2): the
  // same family sections and cited notes as ShaperList, each row with up to four chips,
  // and the chips that would narrow the list offered above it. A search or a chosen chip
  // opens the folded sections. Rules in shaper-chips.ts and chips.ts.
  import { SvelteSet } from "svelte/reactivity";
  import Chip from "./Chip.svelte";
  import ChipFacets from "./ChipFacets.svelte";
  import RuleList from "./RuleList.svelte";
  import type { KeptUp } from "./api.ts";
  import { narrowSections, type Section } from "./advice/catalogue.ts";
  import { facets, grouped, narrow, shown } from "./chips.ts";
  import { SHAPER_GROUPS, keptLowForShaper, shaperChips, type Badge } from "./shaper-chips.ts";

  type Item = { name: string; warn?: string; note?: string; gen?: number; disabled?: boolean };
  let {
    sections,
    items,
    current,
    badges = {},
    isSdm,
    rateHz,
    mode,
    keptUp,
    disabled = false,
    onpick,
  }: {
    sections: Section[];
    items: readonly Item[];
    current: string;
    badges?: Record<string, Badge>;
    isSdm: boolean;
    rateHz: number;
    mode: string;
    keptUp: KeptUp[];
    disabled?: boolean;
    onpick: (name: string) => void;
  } = $props();

  let query = $state("");
  const keys = new SvelteSet<string>();
  let opened = $state<string[]>([]);
  let expanded = $state<string | null>(null);

  const rows = $derived(
    items.map((i) => ({
      item: i,
      name: i.name,
      chips: shaperChips(i, {
        isSdm,
        inUse: i.name === current,
        rateHz,
        keptLow: keptLowForShaper(keptUp, { mode, rateHz, name: i.name }),
        badge: badges[i.name],
      }),
    })),
  );
  const byName = $derived(new Map(rows.map((r) => [r.name, r])));
  const offered = $derived(grouped(facets(rows.map((r) => r.chips)), SHAPER_GROUPS));
  const kept = $derived(new Set(narrow(rows, keys).map((r) => r.name)));
  const hidden = $derived(new Set(rows.filter((r) => !kept.has(r.name)).map((r) => r.name)));
  const shownSections = $derived(narrowSections(sections, query, hidden).map((s) => ({ ...s, open: s.open || keys.size > 0 })));
  const total = $derived(sections.reduce((n, s) => n + s.names.length, 0));
  const count = $derived(shownSections.reduce((n, s) => n + s.names.length, 0));
  const isOpen = (s: Section) => s.open || opened.includes(s.key);
</script>

<div class="bar">
  <input class="search" type="search" placeholder="Search {total}…" aria-label="Search" autocomplete="off" bind:value={query} />
  <ChipFacets {offered} {keys} count="{count} of {total}" />
</div>
{#if !shownSections.length}<p class="none">Nothing matches.</p>{/if}

<ul class="list">
  {#each shownSections as s (s.key)}
    <li class="group">
      {s.title} · {s.names.length}
      {#if s.note}<div class="gnote"><RuleList rules={[s.note]} /></div>{/if}
    </li>
    {#each isOpen(s) ? s.names : s.names.filter((n) => n === current) as name (name)}
      {@const r = byName.get(name)}
      {@const sh = shown(r?.chips ?? [])}
      {@const open = expanded === name}
      <li class="row" class:current={name === current}>
        <button
          class="main"
          aria-current={name === current ? "true" : undefined}
          disabled={disabled || r?.item.disabled}
          onclick={() => name !== current && onpick(name)}
        >
          <span class="name">{name}</span>
          {#if name === current}<span class="tick" aria-label="selected">✓</span>{/if}
        </button>
        <div class="chips">
          {#each open ? (r?.chips ?? []) : sh.chips as c (c.key)}<Chip kind={c.kind} label={c.label} />{/each}
          {#if sh.more || r?.item.warn || r?.item.note}
            <button class="more" aria-expanded={open} onclick={() => (expanded = open ? null : name)}
              >{open ? "less" : sh.more ? `+${sh.more} · why?` : "why?"}</button
            >
          {/if}
        </div>
        {#if open && (r?.item.warn || r?.item.note)}
          <p class="why">{[r?.item.warn, r?.item.note].filter(Boolean).join(" · ")}</p>
        {/if}
      </li>
    {/each}
    {#if !isOpen(s)}
      <li class="fold">
        <button class="link" onclick={() => (opened = [...opened, s.key])}>Show all {s.names.length}</button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .bar {
    margin: 0 16px 8px;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 8px;
    min-height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .none {
    margin: 8px 20px;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .group {
    padding: 16px 12px 6px;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-top: 1px solid var(--border);
  }
  .group:first-child {
    border-top: 0;
  }
  .gnote {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  .gnote :global(ul) {
    list-style: none;
    padding-left: 0;
  }
  .row {
    padding: 6px 12px 8px;
    border-top: 1px solid var(--border);
  }
  .row.current {
    background: var(--accent-soft);
  }
  .main {
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
  .main:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 500;
    overflow-wrap: anywhere;
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
  .fold {
    padding: 6px 12px 10px;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
</style>
