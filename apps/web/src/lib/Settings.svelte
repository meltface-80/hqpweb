<script lang="ts">
  import { tick } from "svelte";
  // Settings sheet: per-device preferences, learned failures for the selected
  // instance, and About.
  import { api, can, formatRate, type Failure, type Inst } from "./api.ts";
  import { THEMES, prefs, savePrefs, type Prefs } from "./prefs.svelte.ts";
  import InstanceSettings from "./InstanceSettings.svelte";
  import RoonSettings from "./RoonSettings.svelte";
  import SetupSettings from "./SetupSettings.svelte";
  import RestartCapSettings from "./RestartCapSettings.svelte";
  import MeterCalibrate from "./MeterCalibrate.svelte";
  import More from "./More.svelte";
  import { clampNudge, nudgeForDelay } from "./meter-delay.ts";
  import { AGE_STOPS } from "./fit/evidence.ts";
  import { ageSentence, ageStop } from "./fit/sheet.ts";

  let {
    instance,
    instances,
    onforgot,
    onchange,
    outputDelayMs = null,
  }: {
    instance: Inst | null;
    instances: Inst[];
    /** HQPlayer's output buffer as last seen (the meter's timing starts from it). */
    outputDelayMs?: number | null;
    onforgot: () => void;
    onchange: () => Promise<void>;
  } = $props();

  let dialog: HTMLDialogElement;
  let calibrator = $state<MeterCalibrate>();
  const nudge = $derived(instance ? (prefs.meterNudge[instance.id] ?? 0) : 0);
  /** The meter's nudge for this HQPlayer, as MeterStrip keeps it (per device). */
  function setNudge(ms: number | null) {
    if (!instance) return;
    const next = { ...prefs.meterNudge };
    if (ms === null) delete next[instance.id];
    else next[instance.id] = clampNudge(ms);
    prefs.meterNudge = next;
    savePrefs();
  }
  // Absent when the host has no Roon (api.ts can).
  let roon = $state<RoonSettings>();
  // Four tabs (owner's call, 2026-10-09): the HQPlayer and its DAC, listening, appearance, Roon.
  let tab = $state<"hqplayer" | "listening" | "appearance" | "roon">("hqplayer");
  let learned = $state<(Failure & { engine: string })[] | null>(null);
  let learnedError = $state("");

  /** Open, optionally on a tab and scrolled to a section (the meter's "Settings ›" opens Meter timing). */
  export async function open(opts: { tab?: typeof tab; section?: string } = {}) {
    if (opts.tab) tab = opts.tab;
    dialog.showModal();
    loadLearned();
    roon?.refresh();
    if (opts.section) {
      await tick();
      dialog.querySelector(`#${opts.section}`)?.scrollIntoView({ block: "start" });
    }
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

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog.close()} onclose={() => roon?.stop()}>
  <div class="sheet">
    <header>
      <h3>Settings</h3>
      <button class="close" onclick={() => dialog.close()} aria-label="Close">✕</button>
    </header>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === "hqplayer"} class:on={tab === "hqplayer"} onclick={() => (tab = "hqplayer")}
        >HQPlayer</button
      >
      <button role="tab" aria-selected={tab === "listening"} class:on={tab === "listening"} onclick={() => (tab = "listening")}
        >Listening</button
      >
      <button role="tab" aria-selected={tab === "appearance"} class:on={tab === "appearance"} onclick={() => (tab = "appearance")}
        >Appearance</button
      >
      {#if can.roon}
        <button
          role="tab"
          aria-selected={tab === "roon"}
          class:on={tab === "roon"}
          onclick={() => ((tab = "roon"), roon?.refresh())}>Roon</button
        >
      {/if}
    </div>
    <!-- One scrolling area under the tabs: each tab, then About after it. -->
    <div class="scroll">
      <div class="body" hidden={tab !== "roon"}>
        {#if can.roon}<RoonSettings bind:this={roon} {instances} />{/if}
      </div>
      <div class="body" hidden={tab !== "hqplayer"}>
        <InstanceSettings {instances} {onchange} />
        <SetupSettings {instance} {onchange} />
        <h4>Learned performance{instance ? ` · ${instance.name}` : ""}</h4>
        <label class="row">
          <span>Sort filters by what's worked here</span>
          <input
            type="checkbox"
            role="switch"
            checked={prefs.fitSort}
            onchange={(e) => set("fitSort", e.currentTarget.checked)}
          />
        </label>
        <p class="help">Filters that failed here, or probably would, go below the others.</p>
        <More>Picking one of those asks first. Off: one plain list. On this device.</More>
        <label class="age">
          <span>{ageSentence(prefs.fitMaxAgeDays)}</span>
          <input
            type="range"
            min="0"
            max={AGE_STOPS.length - 1}
            step="1"
            value={ageStop(prefs.fitMaxAgeDays)}
            disabled={!prefs.fitSort}
            aria-label="Forget load results older than"
            aria-valuetext={ageSentence(prefs.fitMaxAgeDays)}
            oninput={(e) => set("fitMaxAgeDays", AGE_STOPS[Number(e.currentTarget.value)] ?? null)}
          />
        </label>
        <More>
          A new machine, CUDA or a bigger buffer can change what keeps up. Older results are ignored, not deleted: change this
          back and they count again.
        </More>
        <h5>Failures</h5>
        <p class="help">Combinations rolled back here. They show as warnings; nothing is blocked.</p>
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
      </div>
      <div class="body" hidden={tab !== "listening"}>
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

        {#if can.restartCap}<RestartCapSettings {instance} {onchange} />{/if}

        {#if instance && can.calibrate}
          <h4 id="meter-timing">Meter timing</h4>
          <p class="help">
            Line the meter up with what you hear.{nudge
              ? ` Set by ear: ${nudge > 0 ? "+" : "−"}${Math.abs(nudge / 1000).toFixed(2)} s.`
              : ""}
          </p>
          <button class="small" onclick={() => calibrator?.open()}>Line up by ear…</button>
          {#if nudge}<button class="small" onclick={() => setNudge(null)}>Reset</button>{/if}
          <More>
            hqpweb plays six claps through HQPlayer and you tap each one; it stops what's playing. Without it, the meter follows
            HQPlayer's own buffer, and the NAA and DAC add their own delay, which only your ears can measure.
          </More>
        {/if}
      </div>
      <div class="body" hidden={tab !== "appearance"}>
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

        <label class="row">
          <span>Open “Advanced” by default</span>
          <input
            type="checkbox"
            role="switch"
            checked={prefs.advancedOpen}
            onchange={(e) => set("advancedOpen", e.currentTarget.checked)}
          />
        </label>
      </div>
      <div class="body about">
        <h4>About</h4>
        <p class="help">
          hqpweb {__APP_VERSION__}{__APP_COMMIT__ ? ` (${__APP_COMMIT__})` : ""}: a web controller for HQPlayer, beta.
          <a href="https://github.com/statelycurmudgeon/hqpweb" target="_blank" rel="noopener noreferrer">Source and issues</a>.
        </p>
        <p class="help">
          Not affiliated with, endorsed by, or supported by Signalyst or Roon Labs. HQPlayer is a trademark of Signalyst; Roon is
          a trademark of Roon Labs LLC. Colour themes adapted from MusicD Remote (MIT).
        </p>
      </div>
    </div>
  </div>
</dialog>
{#if instance}
  <MeterCalibrate
    bind:this={calibrator}
    instanceId={instance.id}
    {outputDelayMs}
    onresult={(ms, buffer) => setNudge(nudgeForDelay(ms, buffer))}
  />
{/if}

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
  /* The sheet's top stays put when tabs change height: a fixed height on phones (it sits on
     the bottom edge), and pinned below the top of the page on wider screens. */
  @media (min-width: 40rem) {
    dialog {
      margin: 48px auto auto;
    }
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.5);
  }
  .sheet {
    background: var(--bg-elev);
    border-radius: 16px 16px 0 0;
    height: 88vh;
    display: flex;
    flex-direction: column;
    padding-bottom: env(safe-area-inset-bottom);
    box-shadow: var(--shadow-card);
  }
  @media (min-width: 40rem) {
    .sheet {
      border-radius: 16px;
      height: auto;
      max-height: calc(100vh - 96px);
    }
  }
  h5 {
    margin: 16px 0 4px;
    font-size: 0.85rem;
    color: var(--text-dim);
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
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .body {
    padding: 0 16px 16px;
  }
  .body[hidden] {
    display: none;
  }
  .age {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }
  .age input {
    width: 100%;
    accent-color: var(--accent);
  }
  .small {
    font: inherit;
    min-height: 40px;
    padding: 0 14px;
    margin: 4px 8px 0 0;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--accent-text);
    cursor: pointer;
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
