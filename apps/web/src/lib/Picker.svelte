<script lang="ts">
  // A searchable picker for long lists (36–77 items). Opens as a bottom sheet.
  // Items can be disabled (with a reason) or carry a warning, e.g. "failed here before".
  type Item = { index: number; name: string; disabled?: boolean; note?: string; warn?: string };
  let {
    label,
    items,
    current,
    hint = "",
    disabled = false,
    onpick,
  }: {
    label: string;
    items: Item[];
    current: string;
    hint?: string;
    disabled?: boolean;
    onpick: (item: Item) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let query = $state("");
  let search: HTMLInputElement;

  const shown = $derived(
    query.trim() ? items.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase())) : items,
  );

  function open() {
    query = "";
    dialog.showModal();
    // Don't pop the keyboard on phones; do focus search on desktop.
    if (matchMedia("(pointer: fine)").matches) search.focus();
  }
  function pick(item: Item) {
    if (item.disabled) return;
    dialog.close();
    if (item.name !== current) onpick(item);
  }
</script>

<button class="row" onclick={open} {disabled}>
  <span class="label">{label}{#if hint}<span class="hint">{hint}</span>{/if}</span>
  <span class="value">{current || "—"}</span>
  <span class="chev" aria-hidden="true">›</span>
</button>

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="sheet">
    <header>
      <h3>{label}</h3>
      <button class="close" onclick={() => dialog.close()} aria-label="Close">✕</button>
    </header>
    <input bind:this={search} bind:value={query} type="search" placeholder="Search {items.length}…" autocomplete="off" />
    <ul>
      {#each shown as item (item.index)}
        <li>
          <button class:current={item.name === current} class:warn={!!item.warn} disabled={item.disabled} onclick={() => pick(item)}>
            <span class="name">
              {item.name}
              {#if item.warn}<small class="why">⚠ {item.warn}</small>{:else if item.note}<small class="why">{item.note}</small>{/if}
            </span>
            {#if item.name === current}<span class="tick">✓</span>{/if}
          </button>
        </li>
      {:else}
        <li class="empty">No match</li>
      {/each}
    </ul>
  </div>
</dialog>

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 14px 16px;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:disabled { opacity: 0.5; cursor: progress; }
  .row:not(:last-child) { border-bottom: 1px solid var(--line); }
  .label { color: var(--muted); white-space: nowrap; }
  .hint {
    margin-left: 6px;
    font-size: 0.72rem;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    vertical-align: 1px;
  }
  .value { text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .chev { color: var(--muted); font-size: 1.3rem; line-height: 1; }

  dialog {
    padding: 0;
    border: 0;
    background: transparent;
    width: min(100%, 34rem);
    max-width: 100%;
    max-height: 100%;
    margin: auto auto 0;
    color: var(--fg);
  }
  @media (min-width: 40rem) { dialog { margin: auto; } }
  dialog::backdrop { background: rgb(0 0 0 / 0.45); }
  .sheet {
    background: var(--card);
    border-radius: 16px 16px 0 0;
    display: flex;
    flex-direction: column;
    max-height: 80vh;
    padding-bottom: env(safe-area-inset-bottom);
  }
  @media (min-width: 40rem) { .sheet { border-radius: 16px; } }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 6px; }
  h3 { margin: 0; font-size: 1rem; }
  .close { background: none; border: 0; color: var(--muted); font-size: 1rem; padding: 6px; cursor: pointer; }
  input {
    margin: 6px 16px 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: inherit;
    font: inherit;
  }
  ul { list-style: none; margin: 0; padding: 0 0 8px; overflow-y: auto; }
  li button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    padding: 12px 16px;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  li button:hover { background: var(--hover); }
  li button.current { color: var(--accent); font-weight: 600; }
  li button:disabled { opacity: 0.45; cursor: not-allowed; }
  .name { display: flex; flex-direction: column; }
  .why { font-size: 0.78rem; color: var(--muted); font-weight: 400; }
  li button.warn .why { color: var(--warn); }
  .empty { padding: 12px 16px; color: var(--muted); }
</style>
