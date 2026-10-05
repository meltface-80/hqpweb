<script lang="ts">
  import { tick } from "svelte";
  // A searchable picker for long lists (36–77 items). Opens as a bottom sheet.
  // Items can be disabled (with a reason) or carry a warning, e.g. "failed here before".
  // Filters carry a rating, focus tags and a ratio rule (HQPlayer 6's, borrowed by name for v5), and
  // modulators a generation: shown as stars (ⓘ for details) or a "Gen" badge, with
  // chips to narrow the list and an optional grouping by rating.
  // Items that can't do the current conversion ratio are `blocked`: hidden by a
  // "compatible" chip that's on by default, and struck through when shown. Picking
  // one is still allowed; the caller decides what to offer (e.g. a rate switch).
  type Item = {
    index: number;
    name: string;
    disabled?: boolean;
    note?: string;
    warn?: string;
    rating?: number;
    tags?: string[];
    ratioText?: string;
    gen?: number;
    /** Why it can't do the current ratio, e.g. "needs a power-of-two ratio; … is 4.35×". */
    blocked?: string;
    /** Apodizing per HQPlayer's table: true, false, or "partial" (½); undefined when unknown. */
    apodizing?: boolean | "partial";
  };
  let {
    label,
    items,
    current,
    hint = "",
    active = null,
    disabled = false,
    groupByRating = false,
    ratioLabel = "",
    onpick,
  }: {
    label: string;
    items: Item[];
    current: string;
    hint?: string;
    /** true: HQPlayer reports this selection active; false: it doesn't; null: not applicable. */
    active?: boolean | null;
    disabled?: boolean;
    /** Sections by rating instead of HQPlayer's order (only when items have ratings). */
    groupByRating?: boolean;
    /** The conversion being checked, e.g. "44.1 kHz → 192 kHz", for the hidden-items line. */
    ratioLabel?: string;
    onpick: (item: Item) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let query = $state("");
  let search: HTMLInputElement;
  let chips = $state<Set<string>>(new Set());
  let openInfo = $state<number | null>(null);
  let compatOnly = $state(true);

  const rated = $derived(items.some((i) => i.rating !== undefined));
  const tagChips = $derived([...new Set(items.flatMap((i) => i.tags ?? []))].sort());
  const anyWarn = $derived(items.some((i) => i.warn || i.disabled));
  const anyApodizing = $derived(items.some((i) => i.apodizing === true));
  const blockedCount = $derived(items.filter((i) => i.blocked && i.name !== current).length);
  const toggle = (c: string) => {
    const next = new Set(chips);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    chips = next;
  };
  const shown = $derived(
    items.filter((i) => {
      const q = query.trim().toLowerCase();
      if (q && !i.name.toLowerCase().includes(q) && !(i.tags ?? []).some((t) => t.includes(q))) return false;
      if (compatOnly && i.blocked && i.name !== current) return false;
      if (chips.has("5/5") && i.rating !== 5) return false;
      if (chips.has("apodizing") && i.apodizing !== true) return false;
      if (chips.has("works here") && (i.warn || i.disabled)) return false;
      for (const t of tagChips) if (chips.has(t) && !(i.tags ?? []).includes(t)) return false;
      return true;
    }),
  );
  const groups = $derived(
    groupByRating && rated
      ? [5, 4, 3, 2, 1, 0]
          .map((r) => ({ rating: r, items: shown.filter((i) => (i.rating ?? 0) === r) }))
          .filter((g) => g.items.length)
      : [{ rating: -1, items: shown }],
  );
  /** Some rows have ⓘ: the others keep its column, so stars line up. */
  const anyInfo = $derived(items.some((i) => i.tags?.length || i.ratioText || i.apodizing));
  // HQPlayer's terse ratio wording, said plainly.
  const RATIO_WORDS: Record<string, string> = {
    Any: "any conversion ratio",
    "Any up": "any ratio, upsampling only",
    Int: "whole-number ratios",
    "Int up": "whole-number ratios, upsampling only",
    "2^x": "power-of-two ratios",
    "2^x up": "power-of-two ratios, upsampling only",
    "1:1": "no rate conversion",
  };

  /** Open the sheet; `chips` pre-selects narrowing chips, e.g. ["apodizing"]. */
  export async function open(opts: { chips?: string[] } = {}) {
    chips = new Set(opts.chips ?? []);
    query = "";
    openInfo = null;
    compatOnly = true;
    await tick(); // let the narrowing apply before looking for the current row
    dialog.showModal();
    const list = dialog.querySelector("ul");
    if (list) list.scrollTop = 0;
    dialog.querySelector(".main.current")?.scrollIntoView({ block: "center" });
    // Don't pop the keyboard on phones; do focus search on desktop.
    if (matchMedia("(pointer: fine)").matches) search.focus();
  }
  function pick(item: Item) {
    if (item.disabled) return;
    dialog.close();
    if (item.name !== current) onpick(item);
  }
</script>

<button class="row" onclick={() => open()} {disabled}>
  <span class="label"
    >{label}{#if hint}<span class="hint">{hint}</span>{/if}</span
  >
  <span class="value">
    {#if active === true}<span class="taken" title="Active in HQPlayer">✓</span>{:else if active === false}<span
        class="not-taken"
        title="HQPlayer reports a different one active">⚠</span
      >{/if}
    {current || "—"}
  </span>
  <span class="chev" aria-hidden="true">›</span>
</button>

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="sheet">
    <header>
      <h3>{label}</h3>
      <button class="close" onclick={() => dialog.close()} aria-label="Close"
        ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button
      >
    </header>
    <label class="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
      <input bind:this={search} bind:value={query} type="search" placeholder="Search {items.length}…" autocomplete="off" />
    </label>
    {#if rated || anyWarn || blockedCount || anyApodizing}
      <div class="chips" role="group" aria-label="Narrow the list">
        {#if blockedCount}
          <button class:on={compatOnly} aria-pressed={compatOnly} onclick={() => (compatOnly = !compatOnly)}>compatible</button>
        {/if}
        {#if anyApodizing}
          <button class:on={chips.has("apodizing")} aria-pressed={chips.has("apodizing")} onclick={() => toggle("apodizing")}
            >apodizing</button
          >
        {/if}
        {#if rated}
          <button class:on={chips.has("5/5")} aria-pressed={chips.has("5/5")} onclick={() => toggle("5/5")}>★ 5/5</button>
          {#each tagChips as t (t)}
            <button class:on={chips.has(t)} aria-pressed={chips.has(t)} onclick={() => toggle(t)}>{t}</button>
          {/each}
        {/if}
        {#if anyWarn}
          <button class:on={chips.has("works here")} aria-pressed={chips.has("works here")} onclick={() => toggle("works here")}
            >✓ works here</button
          >
        {/if}
      </div>
    {/if}
    {#if blockedCount && compatOnly}
      <p class="hidden-note">
        {blockedCount} hidden: they can't convert {ratioLabel || "at this ratio"}.
        <button class="link" onclick={() => (compatOnly = false)}>Show all</button>
      </p>
    {/if}
    <ul>
      {#each groups as g (g.rating)}
        {#if g.rating >= 0}<li class="group">
            {g.rating ? `${g.rating} star${g.rating === 1 ? "" : "s"}` : "Not rated"} · {g.items.length}
          </li>{/if}
        {#each g.items as item (item.index)}
          {@const info = item.tags?.length || item.ratioText || item.apodizing}
          <li>
            <div class="item">
              <button
                class="main"
                class:current={item.name === current}
                aria-current={item.name === current ? "true" : undefined}
                class:warn={!!item.warn}
                class:blocked={!!item.blocked}
                disabled={item.disabled}
                onclick={() => pick(item)}
              >
                <span class="name">
                  {item.name}
                  {#if item.blocked}<small class="why">{item.blocked}</small>{:else if item.warn}<small class="why"
                      >⚠ {item.warn}</small
                    >{:else if item.note}<small class="why">{item.note}</small>{/if}
                </span>
                <span class="trail">
                  {#if item.blocked && item.ratioText}<s class="ratio" title="Can't do this conversion">{item.ratioText}</s>{/if}
                  {#if item.rating !== undefined && !(groupByRating && rated)}<span
                      class="stars"
                      role="img"
                      aria-label="{item.rating} of 5"
                      >{"★".repeat(item.rating)}<span class="off">{"★".repeat(5 - item.rating)}</span></span
                    >{/if}
                  {#if item.gen !== undefined}<span class="gen" title="Modulator generation">Gen {item.gen}</span>{/if}
                </span>
              </button>
              {#if info}
                <button
                  class="info"
                  class:open={openInfo === item.index}
                  aria-label="Details for {item.name}"
                  aria-expanded={openInfo === item.index}
                  onclick={() => (openInfo = openInfo === item.index ? null : item.index)}
                  ><svg viewBox="0 0 24 24" aria-hidden="true"
                    ><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.1" /></svg
                  ></button
                >
              {:else if anyInfo}
                <span class="info" aria-hidden="true"></span>
              {/if}
            </div>
            {#if info && openInfo === item.index}
              <p class="details">
                {#if item.tags?.length}Favours {item.tags.join(", ")}.{/if}
                {#if item.ratioText}Works with {RATIO_WORDS[item.ratioText] ?? item.ratioText}.{/if}
                {#if item.apodizing === true}Apodizing.{:else if item.apodizing === "partial"}Partly apodizing.{/if}
              </p>
            {/if}
          </li>
        {/each}
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
  .trail {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ratio {
    font-size: 0.72rem;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-faint);
    white-space: nowrap;
  }
  li .main.blocked .name {
    color: var(--text-dim);
  }
  li .main.blocked .why {
    color: var(--warn);
  }
  .hidden-note {
    margin: -6px 16px 12px;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--accent-text);
    font-weight: 600;
    cursor: pointer;
  }
  .stars {
    color: var(--accent-text);
    font-size: 0.78rem;
    letter-spacing: 2px;
    white-space: nowrap;
  }
  .stars .off {
    color: var(--border);
  }
  .gen {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .info {
    display: grid;
    place-items: center;
    width: 40px;
    height: 44px;
    background: none;
    border: 0;
    color: var(--text-faint);
    cursor: pointer;
  }
  .info.open {
    color: var(--accent-text);
  }
  .details {
    margin: 0 12px 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg);
    font-size: 0.84rem;
    line-height: 1.45;
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
  .group {
    padding: 16px 12px 6px;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text);
  }
  .group:not(:first-child) {
    margin-top: 6px;
    border-top: 1px solid var(--border);
  }
</style>
