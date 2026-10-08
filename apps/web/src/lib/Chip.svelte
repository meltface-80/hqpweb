<script lang="ts">
  // One chip (docs/design-v2-layout.md rule 2). The kind sets the look; the label carries
  // a symbol or word for it (✓, ✗, "in use"), so meaning never rests on colour.
  import type { ChipKind } from "./chips.ts";

  let { kind, label, pressed, onclick }: { kind: ChipKind; label: string; pressed?: boolean; onclick?: () => void } = $props();
</script>

{#if onclick}
  <button class="chip {kind}" class:on={pressed} aria-pressed={pressed} {onclick}>{label}</button>
{:else}
  <span class="chip {kind}">{label}</span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 10px;
    white-space: nowrap;
    border: 1px solid transparent;
    background: var(--bg-elev-2);
    color: var(--text-dim);
  }
  .good {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  }
  .trouble {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 45%, transparent);
  }
  .suggested {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .inuse {
    background: var(--text);
    color: var(--bg);
  }
  button.chip {
    box-sizing: border-box;
    height: 36px;
    line-height: 1;
    padding: 0 12px;
    font-size: 0.82rem;
    border-radius: 18px;
    border-color: var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  button.chip.on {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
</style>
