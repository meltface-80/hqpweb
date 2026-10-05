<script lang="ts">
  // Settings sheet: per-device preferences, learned failures for the selected
  // instance, and About.
  import { api, formatRate, type Failure, type Inst } from "./api.ts";
  import { THEMES, prefs, savePrefs, type Prefs } from "./prefs.svelte.ts";
  import InstanceSettings from "./InstanceSettings.svelte";
  import RoonSettings from "./RoonSettings.svelte";

  let {
    instance,
    instances,
    onforgot,
    onchange,
  }: {
    instance: { id: string; name: string } | null;
    instances: Inst[];
    onforgot: () => void;
    onchange: () => Promise<void>;
  } = $props();

  let dialog: HTMLDialogElement;
  let roon: RoonSettings;
  let tab = $state<"general" | "roon">("general");
  let learned = $state<(Failure & { engine: string })[] | null>(null);
  let learnedError = $state("");

  export function open() {
    dialog.showModal();
    loadLearned();
    roon.refresh();
  }

  async function loadLearned() {
    learned = null;
    learnedError = "";
    if (!instance) return;
    try {
      learned = await api.learned(instance.id);
    } catch (e) {
      learnedError = (e as Error).message;
    }
  }

  async function forget() {
    if (!instance || !confirm(`Forget every failed combination learned on ${instance.name}?`)) return;
    await api.forgetLearned(instance.id);
    await loadLearned();
    onforgot();
  }

  function set<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    prefs[k] = v;
    savePrefs();
  }

  const STEPS: Prefs["volumeStep"][] = [0.5, 1, 2];
</script>

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog.close()} onclose={() => roon.stop()}>
  <div class="sheet">
    <header>
      <h3>Settings</h3>
      <button class="close" onclick={() => dialog.close()} aria-label="Close">✕</button>
    </header>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === "general"} class:on={tab === "general"} onclick={() => (tab = "general")}
        >General</button
      >
      <button role="tab" aria-selected={tab === "roon"} class:on={tab === "roon"} onclick={() => ((tab = "roon"), roon.refresh())}
        >Roon</button
      >
    </div>

    <div class="body" hidden={tab !== "roon"}>
      <RoonSettings bind:this={roon} {instances} />
    </div>

    <div class="body" hidden={tab !== "general"}>
      <InstanceSettings {instances} {onchange} />

      <h4>Theme</h4>
      <div class="themes">
        {#each THEMES as t (t.id)}
          <button class="theme" class:on={prefs.theme === t.id} onclick={() => set("theme", t.id)}>
            {#if t.theme}
              <span class="swatch" data-theme={t.theme} data-palette={t.palette}><span></span></span>
            {:else}
              <span class="swatch split">
                <span class="half" data-theme="dark" data-palette="classic"></span>
                <span class="half" data-theme="light" data-palette="classic"></span>
              </span>
            {/if}
            <span class="tx"><b>{t.label}</b><small>{t.note}</small></span>
            {#if prefs.theme === t.id}<span class="check">✓</span>{/if}
          </button>
        {/each}
      </div>

      <h4>Volume buttons</h4>
      <div class="seg" role="radiogroup" aria-label="Volume step">
        {#each STEPS as s (s)}
          <button
            role="radio"
            aria-checked={prefs.volumeStep === s}
            class:on={prefs.volumeStep === s}
            onclick={() => set("volumeStep", s)}
          >
            {s} dB
          </button>
        {/each}
      </div>

      <h4>Filter lists</h4>
      <div class="seg" role="radiogroup" aria-label="Filter list order">
        <button class:on={prefs.filterOrder === "hqplayer"} onclick={() => set("filterOrder", "hqplayer")}
          >HQPlayer's order</button
        >
        <button class:on={prefs.filterOrder === "rating"} onclick={() => set("filterOrder", "rating")}>Grouped by rating</button>
      </div>
      <p class="help">Ratings come from HQPlayer 6, borrowed by name for HQPlayer 5.</p>

      <label class="row">
        <span>Open “Advanced” by default</span>
        <input
          type="checkbox"
          role="switch"
          checked={prefs.advancedOpen}
          onchange={(e) => set("advancedOpen", e.currentTarget.checked)}
        />
      </label>

      <h4>Learned failures{instance ? ` · ${instance.name}` : ""}</h4>
      <p class="help">
        Combinations that stopped playback or couldn't keep up here, so they were rolled back. They show as warnings in the
        pickers; nothing is blocked.
      </p>
      {#if learnedError}
        <p class="err">{learnedError}</p>
      {:else if learned === null}
        <p class="help">Loading…</p>
      {:else if learned.length === 0}
        <p class="help">None yet.</p>
      {:else}
        <ul class="failures">
          {#each learned as f (f.at)}
            <li>
              <b>{f.mode} · {formatRate(f.rateHz, f.mode)}</b>
              <span>{f.filter1x} / {f.filterNx} · {f.shaper}</span>
              <small>{f.reason} · engine {f.engine} · {new Date(f.at).toLocaleString()}</small>
            </li>
          {/each}
        </ul>
        <button class="danger" onclick={forget}>Forget all for this instance</button>
      {/if}

      <h4>About</h4>
      <p class="help">
        hqpweb {__APP_VERSION__}{__APP_COMMIT__ ? ` (${__APP_COMMIT__})` : ""}: a web controller for HQPlayer, beta.
        <a href="https://github.com/statelycurmudgeon/hqpweb" target="_blank" rel="noopener noreferrer">Source and issues</a>.
      </p>
      <p class="help">
        Not affiliated with, endorsed by, or supported by Signalyst or Roon Labs. HQPlayer is a trademark of Signalyst; Roon is a
        trademark of Roon Labs LLC. Colour themes adapted from MusicD Remote (MIT).
      </p>
    </div>
  </div>
</dialog>

<style>
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
    background: rgb(0 0 0 / 0.5);
  }
  .sheet {
    background: var(--bg-elev);
    border-radius: 16px 16px 0 0;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    padding-bottom: env(safe-area-inset-bottom);
    box-shadow: var(--shadow-card);
  }
  @media (min-width: 40rem) {
    .sheet {
      border-radius: 16px;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 4px;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
  }
  .close {
    background: none;
    border: 0;
    color: var(--text-dim);
    font-size: 1rem;
    padding: 6px;
    cursor: pointer;
  }
  .body {
    overflow-y: auto;
    padding: 0 16px 16px;
  }
  .body[hidden] {
    display: none;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin: 6px 16px 4px;
    padding: 3px;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .tabs button {
    flex: 1;
    padding: 8px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    min-height: 40px;
  }
  .tabs button.on {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  h4 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text);
    font-weight: 700;
    margin: 18px 0 8px;
  }
  .help {
    color: var(--text-dim);
    font-size: 0.85rem;
    margin: 0 0 8px;
  }
  .err {
    color: var(--danger);
  }

  .themes {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .theme {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    min-height: 44px;
  }
  .theme.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .tx {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .tx small {
    color: var(--text-dim);
    font-size: 0.78rem;
  }
  .check {
    color: var(--accent-text);
    font-weight: 700;
  }
  /* Each swatch sets its own data-theme/palette, so it shows that theme's colours. */
  .swatch {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--bg);
    border: 1px solid var(--border);
    display: grid;
    place-items: center;
    flex: none;
    overflow: hidden;
  }
  .swatch > span:not(.half) {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
  }
  .swatch.split {
    display: flex;
  }
  .half {
    flex: 1;
    height: 100%;
    background: var(--bg);
  }

  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .seg button {
    flex: 1;
    padding: 10px;
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    min-height: 44px;
  }
  .seg button.on {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    min-height: 44px;
    cursor: pointer;
  }
  .row input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }

  .failures {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .failures li {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .failures span {
    overflow-wrap: anywhere;
  }
  .failures small {
    color: var(--text-dim);
  }
  .danger {
    font: inherit;
    padding: 10px 16px;
    border-radius: 999px;
    border: 1px solid var(--danger);
    color: var(--danger);
    background: none;
    cursor: pointer;
    min-height: 44px;
  }
</style>
