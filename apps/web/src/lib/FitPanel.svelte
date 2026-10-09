<script lang="ts">
  // "What would it take?" under a filter that won't fit as set: the fewest changes to the
  // other settings that would let it play, nearest first (fit/sheet.ts whatItTakes). The
  // filter stays; the modulator (or dither) and the rate can be kept too.
  import type { Change } from "./api.ts";
  import { suggestionChange, suggestionLabel, suggestionStatus, whatItTakes, type SheetFit } from "./fit/sheet.ts";

  let { sheet, name, onapply }: { sheet: SheetFit; name: string; onapply: (c: Change) => void } = $props();

  let keepShaper = $state(false);
  let keepRate = $state(false);
  const found = $derived(whatItTakes(sheet, name, { shaper: keepShaper, rate: keepRate }));
  const shaperWord = $derived(sheet.input.sdm ? "modulator" : "dither");
</script>

<div class="panel">
  <div class="keep">
    <span>Keep</span>
    <label><input type="checkbox" bind:checked={keepShaper} /> {shaperWord}</label>
    {#if sheet.options.rates.length}<label><input type="checkbox" bind:checked={keepRate} /> rate</label>{/if}
  </div>
  {#if found.length}
    <ul>
      {#each found as sg (JSON.stringify(sg.change))}
        <li>
          <div class="what">
            <span class="change">{suggestionLabel(sg, sheet.input.combo)}</span>
            <span class="status">{suggestionStatus(sg)}</span>
          </div>
          <button class="try" onclick={() => onapply(suggestionChange(sheet, name, sg))}>Try</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="none">Nothing within two changes{keepShaper || keepRate ? " with those kept" : ""}.</p>
  {/if}
</div>

<style>
  .panel {
    margin: 8px 0 4px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .keep {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: center;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .keep label {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
    border-top: 1px solid var(--border);
  }
  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .change {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .status {
    font-size: 0.75rem;
    color: var(--text-faint);
  }
  .try {
    flex: none;
    font: inherit;
    min-height: 36px;
    padding: 0 14px;
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--accent-text);
    cursor: pointer;
  }
  .none {
    margin: 6px 0 0;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
</style>
