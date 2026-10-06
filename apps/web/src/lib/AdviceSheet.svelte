<script lang="ts">
  // The modulator / dither picker: a row that opens a sheet with two tabs. List is
  // HQPlayer's whole list, grouped by family; Guide asks about the DAC and suggests where
  // to start. Answers are saved to the instance (Settings shows them too). The tab used
  // last is remembered on this device.
  import { tick } from "svelte";
  import { api, type Setup } from "./api.ts";
  import { prefs, savePrefs } from "./prefs.svelte.ts";
  import { groupDithers, groupModulators } from "./advice/catalogue.ts";
  import { withGuideNotes, withVolumeNotes } from "./advice/list-notes.ts";
  import { modulatorAdvice } from "./advice/modulator.ts";
  import { ditherAdvice } from "./advice/dither.ts";
  import { savedMessage, type SetupKey } from "./setup-questions.ts";
  import ShaperList from "./ShaperList.svelte";
  import ModulatorGuide from "./ModulatorGuide.svelte";
  import DitherGuide from "./DitherGuide.svelte";

  type Item = { name: string; warn?: string; note?: string; gen?: number; disabled?: boolean };
  let {
    isSdm,
    items,
    current,
    active = null,
    disabled = false,
    instanceId,
    setup,
    rateHz,
    rateText,
    processSpeed,
    onpick,
    onsaved,
  }: {
    isSdm: boolean;
    items: Item[];
    current: string;
    /** true: HQPlayer reports this one active; false: it doesn't; null: not applicable. */
    active?: boolean | null;
    disabled?: boolean;
    instanceId: string | null;
    setup: Setup;
    rateHz: number;
    rateText: string;
    processSpeed: number | null;
    onpick: (name: string) => void;
    /** After answers are saved, so the instance list (and Settings) catch up. */
    onsaved: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  const label = $derived(isSdm ? "Modulator" : "Dither");
  const names = $derived(items.map((i) => i.name));

  // Answers saved here show at once, before the instance list is refreshed.
  let local = $state<Setup>({});
  let message = $state("");
  let failed = $state(false);
  // A new instance, or answers that changed on the server (a save here, or Settings),
  // replace them. Keyed by value: the 30 s instance refresh alone doesn't, so an answer
  // whose save failed stays in use until the sheet's instance changes.
  const saved = $derived(`${instanceId}|${JSON.stringify(setup)}`);
  $effect(() => {
    void saved;
    local = {};
  });
  const answers = $derived<Setup>({ ...setup, ...local });

  const modAdvice = $derived(isSdm ? modulatorAdvice({ setup: answers, rateHz, modulators: names, processSpeed }) : null);
  const ditAdvice = $derived(isSdm ? null : ditherAdvice({ setup: answers, rateHz, shapers: names }));
  const sections = $derived(
    isSdm ? groupModulators(names, modAdvice?.status === "ok" ? modAdvice.order : null) : groupDithers(names),
  );
  const badges = $derived.by(() => {
    const b: Record<string, { text: string; kind: "default" | "yours" | "caution" }> = {};
    const s = modAdvice?.status === "ok" ? modAdvice.start : null;
    if (s)
      b[s.name] = s.isDefault ? { text: "HQPlayer's default", kind: "default" } : { text: "For your answers", kind: "yours" };
    for (const n of ditAdvice?.status === "ok" ? ditAdvice.group : []) b[n] = { text: "For your answers", kind: "yours" };
    return b;
  });

  const warnings = $derived(Object.fromEntries(items.filter((i) => i.warn).map((i) => [i.name, i.warn!])));
  const listItems = $derived(
    withVolumeNotes(withGuideNotes(items, new Set(Object.keys(badges).filter((n) => badges[n]?.kind === "yours"))), answers),
  );

  export async function open(opts: { tab?: "list" | "guide" } = {}) {
    if (opts.tab) setTab(opts.tab);
    message = "";
    await tick(); // let the tab render before looking for the current row
    dialog.showModal();
    dialog.querySelector(".main.current")?.scrollIntoView({ block: "center" });
  }
  function setTab(t: "list" | "guide") {
    prefs.adviceTab = t;
    savePrefs();
  }
  function pick(name: string) {
    // Picking from the list closes the sheet, like the other pickers; the guide stays open
    // so its Compare and alternatives can be tried in turn.
    if (prefs.adviceTab === "list") dialog.close();
    if (name !== current) onpick(name);
  }
  async function answer(key: SetupKey, value: string) {
    local = { ...local, [key]: value };
    if (!instanceId) {
      failed = false;
      message = "Not saved: no HQPlayer selected.";
      return;
    }
    try {
      const r = await api.saveSetup(instanceId, { [key]: value });
      failed = false;
      message = `${savedMessage(r.savedNow)} Settings shows it too.`;
      onsaved();
    } catch (e) {
      failed = true;
      message = `Couldn't save: ${e instanceof Error ? e.message : String(e)}. Used for now only.`;
    }
  }
</script>

<button class="row" onclick={() => open()} {disabled}>
  <span class="label">{label}</span>
  <span class="value">
    {#if active === true}<span class="taken" title="Active in HQPlayer">✓</span>{:else if active === false}<span
        class="not-taken"
        title="HQPlayer reports a different one active">⚠</span
      >{/if}
    {current || "—"}
  </span>
  <span class="chev" aria-hidden="true">›</span>
</button>

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog.close()} aria-label={label}>
  <div class="sheet">
    <header>
      <h3>{label}</h3>
      <button class="close" onclick={() => dialog.close()} aria-label="Close"
        ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button
      >
    </header>
    <div class="tabs" role="tablist" aria-label="{label} view">
      <button role="tab" aria-selected={prefs.adviceTab === "list"} onclick={() => setTab("list")}>List</button>
      <button role="tab" aria-selected={prefs.adviceTab === "guide"} onclick={() => setTab("guide")}>Guide</button>
    </div>
    <p class="now">Now using <strong>{current || "—"}</strong></p>
    {#if message}<p class="msg" class:failed role="status">{message}</p>{/if}
    <div class="body">
      {#if prefs.adviceTab === "list"}
        <ShaperList {sections} items={listItems} {current} {badges} {disabled} onpick={pick} />
      {:else if isSdm}
        <ModulatorGuide
          setup={answers}
          {rateHz}
          {rateText}
          {names}
          {warnings}
          {processSpeed}
          {current}
          {disabled}
          onanswer={answer}
          onpick={pick}
        />
      {:else}
        <DitherGuide
          setup={answers}
          {rateHz}
          {rateText}
          {names}
          {warnings}
          {current}
          {disabled}
          onanswer={answer}
          onpick={pick}
        />
      {/if}
      <p class="foot">
        Suggestions follow Signalyst's posts, linked by date; they're starting points, not rules. Every {isSdm
          ? "modulator"
          : "dither"} HQPlayer offers stays in the list.
      </p>
    </div>
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
  .label {
    color: var(--text-dim);
    white-space: nowrap;
  }
  .value {
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .taken {
    color: var(--ok);
    margin-right: 4px;
  }
  .not-taken {
    color: var(--warn);
    margin-right: 4px;
  }
  .chev {
    color: var(--text-dim);
    font-size: 1.3rem;
    line-height: 1;
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
  }
  .close svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
  }
  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin: 0 16px 8px;
    padding: 3px;
    border-radius: 12px;
    background: var(--bg);
  }
  .tabs button {
    font: inherit;
    font-weight: 600;
    min-height: 38px;
    border: 0;
    border-radius: 9px;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  .tabs button[aria-selected="true"] {
    background: var(--bg-elev);
    color: var(--text);
    box-shadow: var(--shadow-card);
  }
  .now,
  .msg {
    margin: 0 20px 8px;
    font-size: 0.85rem;
    color: var(--text-dim);
    overflow-wrap: anywhere;
  }
  .msg {
    color: var(--ok);
  }
  .msg.failed {
    color: var(--danger);
  }
  .body {
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .foot {
    margin: 0;
    padding: 12px 20px 16px;
    font-size: 0.75rem;
    color: var(--text-faint);
  }
</style>
