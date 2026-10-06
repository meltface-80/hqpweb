<script lang="ts">
  // The rules behind a piece of advice, each linked to the post it comes from.
  import type { Rule } from "./advice/policy.ts";
  import { monthLabel } from "./dac-table.ts";

  let { rules }: { rules: readonly Rule[] } = $props();
</script>

{#if rules.length}
  <ul class="rules">
    {#each rules as r (r.text)}
      <li>
        {r.text}
        {#if r.url}(<a href={r.url} target="_blank" rel="noopener noreferrer">Jussi, {monthLabel(r.date)}</a
          >){:else if r.source}({r.source}){/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .rules {
    margin: 6px 0 0;
    padding-left: 1.1rem;
    font-size: 0.8rem;
    color: var(--text-dim);
    display: grid;
    gap: 4px;
  }
  a {
    color: var(--accent-text);
  }
</style>
