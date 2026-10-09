<script lang="ts">
  // A filter note (advice/filter-notes.ts): its plain lines, then where they come from.
  // Jussi's posts link out, dated; from before Feb 2025 they're marked possibly dated, as the
  // modulator advice is (advice/policy.ts).
  import type { FilterNote } from "./advice/filter-notes.ts";
  import { monthLabel } from "./dac-table.ts";

  let { note }: { note: FilterNote } = $props();
  const DATED_BEFORE = "2025-02";
</script>

<div class="note">
  {#each note.lines as line (line)}<p>{line}</p>{/each}
  <p class="cites">
    {#each note.cites as c, i (c.label + (c.url ?? ""))}{i ? " · " : ""}{#if c.url}<a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer">{c.label}, {monthLabel(c.date ?? "")}</a
        >{#if c.date && c.date < DATED_BEFORE}&nbsp;(possibly dated){/if}{:else}{c.label}{/if}{/each}
  </p>
</div>

<style>
  .note {
    margin: 6px 0 2px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--bg);
    font-size: 0.85rem;
    color: var(--text);
  }
  p {
    margin: 0 0 4px;
  }
  .cites {
    margin: 6px 0 0;
    font-size: 0.75rem;
    color: var(--text-dim);
  }
  a {
    color: var(--accent-text);
  }
</style>
