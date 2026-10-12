<script lang="ts">
  import { tick, type Snippet } from "svelte";
  // A searchable picker for a list (output rates, matrix profiles). Opens as a bottom sheet.
  // Items can be disabled (with a reason) or carry a warning, e.g. "failed here before",
  // with a chip to show only those that work here. Filters and modulators have their own
  // sheets (FilterSheet, AdviceSheet).
  type Item = {
    index: number;
    name: string;
    disabled?: boolean;
    note?: string;
    warn?: string;
  };
  let {
    label,
    items,
    current,
    hint = "",
    active = null,
    disabled = false,
    mono = false,
    wrap = false,
    intro,
    onpick,
  }: {
    label: string;
    items: Item[];
    current: string;
    hint?: string;
    /** true: HQPlayer reports this selection active; false: it doesn't; null: not applicable. */
    active?: boolean | null;
    disabled?: boolean;
    /** Values are HQPlayer identifiers, set in the mono font (rule 3 of the layout). */
    mono?: boolean;
    /**
     * A value too long for the row moves below the label and wraps, instead of being cut off: for
     * names people choose (matrix profiles), whose distinguishing part is often at the end.
     */
    wrap?: boolean;
    /** Shown at the top of the sheet, e.g. where the list's entries are set up. With no items, all there is. */
    intro?: Snippet;
    onpick: (item: Item) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  // `wrap`: does the value fit beside the label? Measured, as it depends on the width and the font.
  let rowEl = $state<HTMLButtonElement>();
  let labelEl = $state<HTMLSpanElement>();
  let chevEl = $state<HTMLSpanElement>();
  let measureEl = $state<HTMLSpanElement>();
  let stacked = $state(false);
  $effect(() => {
    if (!wrap || !rowEl || !labelEl || !chevEl || !measureEl) return;
    void current;
    const [row, label, chev, measure] = [rowEl, labelEl, chevEl, measureEl];
    const fit = () => {
      const style = getComputedStyle(row);
      const gap = parseFloat(style.columnGap) || 0;
      const room =
        row.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        label.offsetWidth -
        chev.offsetWidth -
        2 * gap;
      stacked = measure.offsetWidth > room;
    };
    fit();
    // The row's width, and the name's (a new name resizes the measuring copy).
    const watch = new ResizeObserver(fit);
    watch.observe(row);
    watch.observe(measure);
    return () => watch.disconnect();
  });
  let query = $state("");
  let search = $state<HTMLInputElement>();
  let worksHere = $state(false);

  const anyWarn = $derived(items.some((i) => i.warn || i.disabled));
  const shown = $derived(
    items.filter((i) => {
      const q = query.trim().toLowerCase();
      if (q && !i.name.toLowerCase().includes(q)) return false;
      if (worksHere && (i.warn || i.disabled)) return false;
      return true;
    }),
  );

  /** Open the sheet. */
  export async function open() {
    query = "";
    worksHere = false;
    await tick();
    dialog.showModal();
    const list = dialog.querySelector("ul");
    if (list) list.scrollTop = 0;
    dialog.querySelector(".main.current")?.scrollIntoView({ block: "center" });
    // Don't pop the keyboard on phones; do focus search on desktop.
    if (items.length && matchMedia("(pointer: fine)").matches) search?.focus();
  }
  function pick(item: Item) {
    if (item.disabled) return;
    dialog.close();
    if (item.name !== current) onpick(item);
  }
</script>

<button class="row" class:stacked bind:this={rowEl} onclick={() => open()} {disabled}>
  <span class="label" bind:this={labelEl}
    >{label}{#if hint}<span class="hint">{hint}</span>{/if}</span
  >
  {#if wrap}<span class="value measure" class:mono aria-hidden="true" bind:this={measureEl}>{current || "—"}</span>{/if}
  <span class="value" class:mono>
    {#if active === true}<span class="taken" title="Active in HQPlayer">✓</span>{:else if active === false}<span
        class="not-taken"
        title="HQPlayer reports a different one active">⚠</span
      >{/if}
    {current || "—"}
  </span>
  <span class="chev" aria-hidden="true" bind:this={chevEl}>›</span>
</button>

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="sheet">
    <header>
      <h3>{label}</h3>
      <button class="close" onclick={() => dialog.close()} aria-label="Close"
        ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button
      >
    </header>
    {#if intro}<div class="intro">{@render intro()}</div>{/if}
    {#if items.length}
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
        <input bind:this={search} bind:value={query} type="search" placeholder="Search {items.length}…" autocomplete="off" />
      </label>
      {#if anyWarn}
        <div class="chips" role="group" aria-label="Narrow the list">
          <button class:on={worksHere} aria-pressed={worksHere} onclick={() => (worksHere = !worksHere)}>✓ works here</button>
        </div>
      {/if}
      <ul>
        {#each shown as item (item.index)}
          <li>
            <div class="item">
              <button
                class="main"
                class:current={item.name === current}
                aria-current={item.name === current ? "true" : undefined}
                class:warn={!!item.warn}
                disabled={item.disabled}
                onclick={() => pick(item)}
              >
                <span class="name">
                  <span class:mono>{item.name}</span>
                  {#if item.warn}<small class="why">⚠ {item.warn}</small>{:else if item.note}<small class="why">{item.note}</small
                    >{/if}
                </span>
              </button>
            </div>
          </li>
        {:else}
          <li class="empty">No match</li>
        {/each}
      </ul>
    {/if}
  </div>
</dialog>

<style>
  .intro {
    margin: 0 16px 10px;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .row {
    position: relative;
    overflow: hidden;
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
  .row:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  .row:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }
  .label {
    color: var(--text-dim);
    white-space: nowrap;
  }
  .hint {
    margin-left: 6px;
    font-size: 0.72rem;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
    vertical-align: 1px;
  }
  .value {
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  /* The value's width on one line, for `wrap`: measured, never seen. */
  .value.measure {
    position: absolute;
    left: 0;
    top: 0;
    visibility: hidden;
    pointer-events: none;
    overflow: visible;
  }
  /* Too long beside the label: the label and › on the first line, the value below at full width. */
  .row.stacked {
    grid-template-columns: 1fr auto;
    grid-template-areas: "label chev" "value value";
    row-gap: 4px;
  }
  .row.stacked .label {
    grid-area: label;
    justify-self: start; /* its own width, as measured for the fit */
  }
  .row.stacked .chev {
    grid-area: chev;
  }
  .row.stacked .value:not(.measure) {
    grid-area: value;
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .chev {
    color: var(--text-dim);
    font-size: 1.3rem;
    line-height: 1;
  }
  .taken {
    color: var(--ok);
    font-weight: 700;
    margin-right: 4px;
  }
  .not-taken {
    color: var(--warn);
    margin-right: 4px;
  }

  dialog {
    padding: 0;
    border: 0;
    background: transparent;
    width: min(100%, 34rem);
    max-width: 100%;
    max-height: 100%;
    margin: auto auto 0;
    color: var(--text);
  }
  @media (min-width: 40rem) {
    dialog {
      margin: auto;
    }
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
    backdrop-filter: blur(2px);
  }
  .sheet {
    background: var(--bg-elev);
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -8px 32px rgb(0 0 0 / 0.18);
    display: flex;
    flex-direction: column;
    max-height: 82vh;
    padding-bottom: env(safe-area-inset-bottom);
  }
  @media (min-width: 40rem) {
    .sheet {
      border-radius: 22px;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 16px 10px 20px;
  }
  h3 {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .close {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-dim);
    cursor: pointer;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.06);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 16px 12px;
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
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 11px 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px 8px 12px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
  }
  .item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    border-radius: 12px;
  }
  .item:has(.main.current) {
    background: var(--accent-soft);
  }
  li .main {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 13px 4px 13px 12px;
    background: none;
    border: 0;
    border-radius: 12px;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .item:not(:has(.main.current)):hover {
      background: var(--bg-elev-2);
    }
  }
  li .main.current {
    color: var(--accent-text);
    font-weight: 600;
  }
  li .main:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .name {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .why {
    font-size: 0.78rem;
    color: var(--text-dim);
    font-weight: 400;
  }
  li .main.warn .why {
    color: var(--warn);
  }
  .empty {
    padding: 16px 12px;
    color: var(--text-dim);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 16px 14px;
  }
  .chips button {
    font: inherit;
    font-size: 0.84rem;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-dim);
    cursor: pointer;
  }
  .chips button.on {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-text);
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono);
    font-weight: 500;
  }
</style>
