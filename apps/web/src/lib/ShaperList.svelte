<script lang="ts">
  // The modulator or dither list, grouped by family (advice/catalogue.ts). A folded section
  // still shows the one in use. Rows carry the app's usual hints (won't play here, failed
  // here before, generation) and the guide's badge on the starting point.
  import { narrowSections, type Section } from "./advice/catalogue.ts";
  import RuleList from "./RuleList.svelte";

  type Item = { name: string; warn?: string; note?: string; gen?: number; disabled?: boolean };
  let {
    sections,
    items,
    current,
    badges = {},
    disabled = false,
    onpick,
  }: {
    sections: Section[];
    items: readonly Item[];
    current: string;
    /** Badge per name, e.g. { "ASDM7EC-fast": { text: "HQPlayer's default", kind: "default" } }. */
    badges?: Record<string, { text: string; kind: "default" | "yours" | "caution" }>;
    disabled?: boolean;
    onpick: (name: string) => void;
  } = $props();

  const byName = $derived(new Map(items.map((i) => [i.name, i])));
  let opened = $state<string[]>([]);
  const isOpen = (s: Section) => s.open || opened.includes(s.key);
  let query = $state("");
  let worksHere = $state(false);
  const anyWarn = $derived(items.some((i) => i.warn));
  const hidden = $derived(new Set(worksHere ? items.filter((i) => i.warn && i.name !== current).map((i) => i.name) : []));
  const shown = $derived(narrowSections(sections, query, hidden));
  const total = $derived(sections.reduce((n, s) => n + s.names.length, 0));
</script>

<div class="narrow">
  <label class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
    <input bind:value={query} type="search" placeholder="Search {total}…" autocomplete="off" />
  </label>
  {#if anyWarn}
    <button
      class="chip"
      aria-pressed={worksHere}
      onclick={() => (worksHere = !worksHere)}
      title="Hide what won't play at this rate, or has failed on this HQPlayer before">Only what plays here</button
    >
  {/if}
</div>
{#if !shown.length}<p class="none">Nothing matches.</p>{/if}

<ul class="list">
  {#each shown as s (s.key)}
    <li class="group">
      {s.title} · {s.names.length}
      {#if s.note}<div class="gnote"><RuleList rules={[s.note]} /></div>{/if}
    </li>
    {#each isOpen(s) ? s.names : s.names.filter((n) => n === current) as name (name)}
      {@const it = byName.get(name)}
      {@const b = badges[name]}
      <li>
        <button
          class="main"
          class:current={name === current}
          class:warn={!!it?.warn}
          aria-current={name === current ? "true" : undefined}
          disabled={disabled || it?.disabled}
          onclick={() => name !== current && onpick(name)}
        >
          <span class="name">
            {#if name === current}<span class="tick" aria-hidden="true">✓</span>{/if}{name}
            {#if b}<span class="badge {b.kind}">{b.text}</span>{/if}
            {#if it?.warn}<small class="why">⚠ {it.warn}</small>{:else if it?.note}<small class="why">{it.note}</small>{/if}
          </span>
          {#if it?.gen !== undefined}<span class="gen" title="Modulator generation">Gen {it.gen}</span>{/if}
        </button>
      </li>
    {/each}
    {#if !isOpen(s)}
      <li class="more">
        <button class="link" onclick={() => (opened = [...opened, s.key])}>Show all {s.names.length}</button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .narrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 16px 8px;
  }
  .search {
    flex: 1 1 12rem;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-faint);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search svg {
    width: 18px;
    height: 18px;
    flex: none;
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 10px 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
  }
  .chip {
    font: inherit;
    font-size: 0.84rem;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-dim);
    cursor: pointer;
  }
  .chip[aria-pressed="true"] {
    border-color: var(--accent);
    color: var(--accent-text);
    background: var(--accent-soft);
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
    color: var(--text);
    border-top: 1px solid var(--border);
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
  .group:first-child {
    border-top: 0;
  }
  .main {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    background: none;
    border: 0;
    border-top: 1px solid var(--border);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    min-height: 44px;
  }
  .main.current {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }
  .main:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .main:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .tick {
    color: var(--ok);
    margin-right: 2px;
  }
  .why {
    flex-basis: 100%;
    font-weight: 400;
    font-size: 0.78rem;
    color: var(--text-dim);
  }
  .warn .why {
    color: var(--warn);
  }
  .gen {
    font-size: 0.75rem;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .badge {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
    white-space: nowrap;
  }
  .badge.yours {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
    color: var(--ok);
  }
  .badge.caution {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
  }
  .more {
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
