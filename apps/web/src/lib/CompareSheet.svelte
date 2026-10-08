<script lang="ts">
  // Compare (docs/design-v2-layout.md; canvas I5): A as it was playing when opened, B to
  // choose, each a full card in a column; the big A and B buttons switch what plays. Which
  // side is heard is read from State. Rules in compare.ts; changes go through the app's
  // apply (the change engine pauses for a mode switch and rolls back what doesn't play).
  import { api, formatRate, type Capabilities, type Change, type PresetView, type Snapshot } from "./api.ts";
  import {
    asSettings,
    changeFor,
    choicesFor,
    comparableModes,
    differs,
    hearing,
    inMode,
    nowSide,
    switchNote,
    withPreset,
    type Side,
  } from "./compare.ts";

  let {
    caps,
    snap,
    busy,
    selected,
    apply,
  }: {
    caps: Capabilities;
    snap: Snapshot;
    busy: boolean;
    selected: string;
    apply: (change: Change) => Promise<unknown>;
  } = $props();

  let dialog: HTMLDialogElement;
  let a = $state<Side | null>(null);
  let b = $state<Side | null>(null);
  let presets = $state<PresetView[]>([]);
  let saved = $state("");

  const live = $derived(nowSide(caps, snap));
  const heard = $derived(a && b ? hearing(live, a, b) : null);
  const diff = $derived(a && b ? differs(a, b) : new Set<string>());
  const bChoices = $derived(b ? choicesFor(caps, b.mode) : null);
  const modes = $derived(comparableModes(caps));
  const modeWord = (m: string) => (m.startsWith("SDM") ? "DSD" : m);
  const rateWord = (s: Side) => (s.rate ? formatRate(s.rate, s.mode) : "Auto");
  const shapingWord = (s: Side) => (s.mode.startsWith("SDM") ? "modulator" : "dither");
  // The value in use stays offered even when a list doesn't have it (an old preset, say).
  const withCurrent = (list: string[], v: string) => (list.includes(v) ? list : [v, ...list]);

  export async function open() {
    a = nowSide(caps, snap);
    b = { ...a };
    saved = "";
    dialog.showModal();
    presets = await api.presets(selected).catch(() => []);
  }
  async function play(side: Side | null) {
    if (!side || busy) return;
    const c = changeFor(side, live);
    if (Object.keys(c).length) await apply(c);
  }
  async function keep(side: Side | null) {
    await play(side);
    dialog.close();
  }
  function load(which: "a" | "b", id: string) {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    if (which === "a" && a) a = withPreset(a, p.settings, caps);
    if (which === "b" && b) b = withPreset(b, p.settings, caps);
  }
  async function saveB() {
    if (!b) return;
    const name = prompt("Name for B's settings")?.trim();
    if (!name) return;
    try {
      await api.savePreset({ name, settings: asSettings(b) });
      saved = `Saved as "${name}".`;
    } catch (e) {
      saved = `Couldn't save: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
</script>

<dialog bind:this={dialog} class="sheet" aria-label="Compare">
  <div class="head">
    <h3>Compare</h3>
    <button class="done" onclick={() => dialog.close()}>Done</button>
  </div>
  {#if a && b}
    <div class="grid">
      <div class="col">
        <strong class:on={heard === "A"}>A · was playing</strong>
        <select class="load" aria-label="Load a preset into A" value="" onchange={(e) => load("a", e.currentTarget.value)}>
          <option value="">Load preset…</option>
          {#each presets as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </div>
      <div class="col">
        <strong class:on={heard === "B"}>B</strong>
        <select class="load" aria-label="Load a preset into B" value="" onchange={(e) => load("b", e.currentTarget.value)}>
          <option value="">Load preset…</option>
          {#each presets as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </div>

      <span class="h">Mode</span>
      <span class="v" class:diff={diff.has("mode")}>{modeWord(a.mode)}</span>
      <span class="v pick" class:diff={diff.has("mode")}
        >{modeWord(b.mode)}<select
          class="over"
          aria-label="B mode"
          value={b.mode}
          onchange={(e) => (b = inMode(b!, e.currentTarget.value, caps))}
        >
          {#each modes as m (m)}<option value={m}>{modeWord(m)}</option>{/each}
        </select></span
      >

      {#if !bChoices}
        <p class="unseen">
          hqpweb hasn't seen {modeWord(b.mode)}'s lists on this HQPlayer yet. B uses its settings as last seen; switch to
          {modeWord(b.mode)} once to choose them here.
        </p>
      {/if}

      <span class="h">1x filter</span>
      <span class="v" class:diff={diff.has("filter1x")}>{a.filter1x}</span>
      <span class="v" class:pick={!!bChoices} class:diff={diff.has("filter1x")}
        >{b.filter1x}{#if bChoices}<select class="over" aria-label="B 1x filter" bind:value={b.filter1x}>
            {#each withCurrent(bChoices.filters, b.filter1x) as n (n)}<option value={n}>{n}</option>{/each}
          </select>{/if}</span
      >

      <span class="h">Nx filter</span>
      <span class="v" class:diff={diff.has("filterNx")}>{a.filterNx}</span>
      <span class="v" class:pick={!!bChoices} class:diff={diff.has("filterNx")}
        >{b.filterNx}{#if bChoices}<select class="over" aria-label="B Nx filter" bind:value={b.filterNx}>
            {#each withCurrent(bChoices.filters, b.filterNx) as n (n)}<option value={n}>{n}</option>{/each}
          </select>{/if}</span
      >

      <span class="h">Modulator / dither</span>
      <span class="v" class:diff={diff.has("shaper")}>{a.shaper}</span>
      <span class="v" class:pick={!!bChoices} class:diff={diff.has("shaper")}
        >{b.shaper}{#if bChoices}<select class="over" aria-label="B {shapingWord(b)}" bind:value={b.shaper}>
            {#each withCurrent(bChoices.shapers, b.shaper) as n (n)}<option value={n}>{n}</option>{/each}
          </select>{/if}</span
      >

      <span class="h">Rate</span>
      <span class="v" class:diff={diff.has("rate")}>{rateWord(a)}</span>
      <span class="v" class:pick={!!bChoices} class:diff={diff.has("rate")}
        >{rateWord(b)}{#if bChoices}<select
            class="over"
            aria-label="B rate"
            value={b.rate}
            onchange={(e) => (b = { ...b!, rate: Number(e.currentTarget.value) })}
          >
            {#each bChoices.rates as r (r.rate)}<option value={r.rate} disabled={!r.allowed}
                >{r.rate ? formatRate(r.rate, b.mode) : "Auto"}</option
              >{/each}
          </select>{/if}</span
      >
    </div>

    <div class="ab" role="group" aria-label="Play">
      <button class="big" aria-pressed={heard === "A"} disabled={busy} onclick={() => play(a)}>A</button>
      <button class="big" aria-pressed={heard === "B"} disabled={busy} onclick={() => play(b)}>B</button>
    </div>
    <div class="note" role="status">
      <strong
        >{busy
          ? "Switching…"
          : heard
            ? `Hearing ${heard}`
            : "Hearing neither: settings changed elsewhere, or a switch was undone"}</strong
      >
      {#each switchNote(a, b) as line (line)}<span>{line}</span>{/each}
    </div>
    <div class="keep">
      <button class="btn" disabled={busy} onclick={() => keep(a)}>Keep A</button>
      <button class="btn" disabled={busy} onclick={() => keep(b)}>Keep B</button>
    </div>
    <button class="btn wide" onclick={saveB}>Save B as a preset</button>
    {#if saved}<p class="saved" role="status">{saved}</p>{/if}
  {/if}
</dialog>

<style>
  .sheet {
    border: 0;
    border-radius: 18px;
    padding: 16px;
    width: min(40rem, 100vw - 24px);
    max-height: 92vh;
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
    margin-bottom: 12px;
  }
  h3 {
    margin: 0;
  }
  .done,
  .btn {
    font: inherit;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 22px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 8px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .col strong.on {
    color: var(--accent-text);
  }
  .h {
    grid-column: 1 / span 2;
    padding-top: 8px;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .v,
  .load {
    box-sizing: border-box;
    min-width: 0;
    width: 100%;
    min-height: 40px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.82rem;
  }
  .v {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }
  /* B's choices: the full name shows and wraps, like A's; the select lies over it, invisible. */
  .pick {
    position: relative;
    padding-right: 26px;
    cursor: pointer;
  }
  .pick::after {
    content: "";
    position: absolute;
    right: 12px;
    top: 50%;
    width: 6px;
    height: 6px;
    margin-top: -5px;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(45deg);
    pointer-events: none;
  }
  .pick:focus-within {
    outline: 2px solid var(--accent);
  }
  .over {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    font-size: 1rem;
  }
  .load {
    color: var(--accent-text);
  }
  .diff {
    border-color: var(--warn);
  }
  .unseen {
    grid-column: 1 / span 2;
    margin: 4px 0 0;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .ab {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  .big {
    flex: 1;
    min-height: 60px;
    border-radius: 14px;
    border: 2px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 1.6rem;
    font-weight: 700;
    cursor: pointer;
  }
  .big[aria-pressed="true"] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .note {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg-elev-2);
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .note strong {
    color: var(--text);
  }
  .keep {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  .keep .btn {
    flex: 1;
  }
  .wide {
    width: 100%;
    margin-top: 10px;
  }
  .saved {
    margin: 8px 0 0;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
</style>
