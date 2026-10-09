<script lang="ts">
  // The guide flow's foot (canvas D2): Back, and Next until the last step, then Done (and
  // Filters →, handing over to the filter sheet, when the caller offers it).
  let {
    step,
    count,
    canGoOn,
    onstep,
    ondone,
    onfilters,
  }: {
    step: number;
    count: number;
    canGoOn: boolean;
    onstep: (n: number) => void;
    ondone: () => void;
    onfilters?: () => void;
  } = $props();
</script>

<footer class="nav">
  <button class="back" disabled={step === 1} onclick={() => onstep(step - 1)}>Back</button>
  {#if step < count}
    <button class="next" disabled={!canGoOn} onclick={() => onstep(step + 1)}>Next</button>
  {:else}
    {#if onfilters}<button class="back" onclick={onfilters}>Filters →</button>{/if}
    <button class="next" onclick={ondone}>Done</button>
  {/if}
</footer>

<style>
  .nav {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
  }
  button {
    font: inherit;
    font-weight: 600;
    min-height: 48px;
    padding: 0 20px;
    border-radius: 24px;
    cursor: pointer;
  }
  .back {
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }
  .next {
    flex: 1;
    border: 0;
    background: var(--accent);
    color: var(--bg);
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
