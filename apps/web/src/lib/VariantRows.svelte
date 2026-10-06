<script lang="ts">
  // Modulators to compare by ear, each with what Signalyst has said about it: CPU load
  // and character, cited (advice/variants.ts). Character, not rank.
  import { variantNote } from "./advice/variants.ts";
  import RuleList from "./RuleList.svelte";

  let {
    names,
    current,
    warnings,
    disabled = false,
    onpick,
  }: {
    names: string[];
    current: string;
    warnings: Record<string, string>;
    disabled?: boolean;
    onpick: (name: string) => void;
  } = $props();
</script>

<ul class="rows">
  {#each names as name (name)}
    {@const note = variantNote(name)}
    <li class="row" class:now={current === name}>
      <div class="top">
        <strong>{name}</strong>
        {#if note?.load}<span class="load">CPU: {note.load}</span>{/if}
        {#if current === name}
          <span class="using">✓ Now using</span>
        {:else}
          <button {disabled} onclick={() => onpick(name)}>Use</button>
        {/if}
      </div>
      {#if note}<RuleList rules={note.rules} />{/if}
      {#if warnings[name]}<p class="warn">⚠ {warnings[name]}</p>{/if}
    </li>
  {/each}
</ul>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .row {
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    display: grid;
    gap: 2px;
  }
  .row.now {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 8%, transparent);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .load {
    font-size: 0.75rem;
    color: var(--text-dim);
  }
  .using {
    margin-left: auto;
    color: var(--ok);
    font-weight: 600;
    font-size: 0.85rem;
  }
  button {
    margin-left: auto;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 36px;
    border-radius: 10px;
    padding: 4px 12px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: inherit;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .warn {
    margin: 0;
    font-size: 0.8rem;
    color: var(--warn);
  }
</style>
