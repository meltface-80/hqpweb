<script lang="ts">
  // History (docs/design-v2-layout.md): what changed on this HQPlayer, when, from where,
  // and how it went. The server keeps it (history.ts); this only shows it.
  import { api, formatRate, type HistoryEntry } from "./api.ts";
  import { historyRows, type HistoryFilter } from "./history-view.ts";

  let { instanceId }: { instanceId: string | null } = $props();

  let dialog: HTMLDialogElement;
  let entries = $state<HistoryEntry[] | null>(null);
  let error = $state("");
  let show = $state<HistoryFilter>("all");

  export async function open() {
    error = "";
    entries = null;
    dialog.showModal();
    if (!instanceId) return;
    try {
      entries = await api.history(instanceId);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  const days = $derived(entries ? historyRows(entries, show, (hz, mode) => formatRate(hz, mode)) : []);
  const FILTERS: { id: HistoryFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "kept", label: "Kept" },
    { id: "rolled-back", label: "Rolled back" },
    { id: "elsewhere", label: "Not made here" },
  ];
</script>

<dialog bind:this={dialog} class="sheet" aria-label="History">
  <div class="head">
    <h3>History</h3>
    <button class="done" onclick={() => dialog.close()}>Done</button>
  </div>
  <div class="filters" role="group" aria-label="Show">
    {#each FILTERS as f (f.id)}
      <button aria-pressed={show === f.id} class:on={show === f.id} onclick={() => (show = f.id)}>{f.label}</button>
    {/each}
  </div>
  {#if error}
    <p class="err">{error}</p>
  {:else if !entries}
    <p class="dim">Loading…</p>
  {:else if !days.length}
    <p class="dim">Nothing yet. Changes show here as they're made, from hqpweb or elsewhere.</p>
  {:else}
    {#each days as d (d.day)}
      <h4>{d.day}</h4>
      <ul>
        {#each d.rows as r (r.key)}
          <li>
            <span class="what"
              >{#each r.parts as p, j (j)}{j ? "; " : ""}{p.label} → <span class="val">{p.value}</span>{/each}</span
            >
            <span class="how {r.tone}">{r.time} · {r.how}</span>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
  <p class="dim foot">Changes made in HQPlayer itself show as "not made here" when hqpweb notices them, while it's open.</p>
</dialog>

<style>
  .sheet {
    border: 0;
    border-radius: 18px;
    padding: 18px;
    width: min(30rem, 100vw - 24px);
    max-height: 85vh;
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
  .filters {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin: 12px 0 4px;
  }
  .filters button {
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .filters button.on {
    background: var(--text);
    color: var(--bg);
  }
  h4 {
    margin: 14px 0 4px;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .what {
    font-size: 0.9rem;
  }
  .val {
    font-family: var(--font-mono);
  }
  .how {
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .how.ok {
    color: var(--ok);
  }
  .how.bad {
    color: var(--warn);
  }
  .dim {
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .foot {
    margin-top: 14px;
  }
  .err {
    color: var(--danger);
  }
</style>
