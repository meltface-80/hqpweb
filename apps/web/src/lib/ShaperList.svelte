<script lang="ts">
  // The modulator or dither list, grouped by family (advice/catalogue.ts). A folded section
  // still shows the one in use. Rows carry the app's usual hints (won't play here, failed
  // here before, generation) and the guide's badge on the starting point.
  import type { Section } from "./advice/catalogue.ts";
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
</script>

<ul class="list">
  {#each sections as s (s.key)}
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
