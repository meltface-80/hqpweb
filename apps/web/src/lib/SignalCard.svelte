<script lang="ts">
  // The v2 signal-path card (docs/design-v2-layout.md): the path line, the mode as tabs
  // (each mode's filters, shaping and rate), the other mode as last seen, and switching
  // mode through a sheet that says what will happen. The rules are in signal.ts and
  // rate-pick.ts; the filter and shaping rows are App's pickers, passed in.
  import type { Snippet } from "svelte";
  import Picker from "./Picker.svelte";
  import { formatRate, type Capabilities, type Change, type Snapshot } from "./api.ts";
  import type { rateItems as rateItemsOf } from "./hints.ts";
  import { pickRate } from "./rate-pick.ts";
  import { autoNote, healthWord, otherMode, pathSteps, seenWhen } from "./signal.ts";
  import type { SpeedClass } from "./speed.ts";

  /** How playback carries on after a mode switch (change-engine.ts, pauseForModeSwitch). */
  export type Resume = "stopped" | "roon-linked" | "roon" | "hqplayer";

  let {
    caps,
    snap,
    busy,
    apply,
    rateItems,
    inUseFilter,
    source,
    outRate,
    dacName,
    resume,
    failedHere,
    speedClass,
    speedText,
    filters,
    shaping,
    onguide,
  }: {
    caps: Capabilities;
    snap: Snapshot;
    busy: boolean;
    apply: (change: Change) => Promise<unknown>;
    rateItems: ReturnType<typeof rateItemsOf>;
    inUseFilter: string;
    source: number;
    outRate: number;
    dacName?: string;
    resume: Resume;
    /** How often the combination in use has failed here (learned failures). */
    failedHere: number;
    speedClass: SpeedClass;
    speedText: string;
    filters: Snippet;
    shaping: Snippet;
    onguide: () => void;
  } = $props();

  const sdm = $derived(caps.mode.name.startsWith("SDM"));
  const shaper = $derived(caps.shapers.find((s) => s.index === snap.state.shaper)?.name ?? "");
  const steps = $derived(pathSteps({ source, filter: inUseFilter, shaper, outRate, modeName: caps.mode.name, dac: dacName }));
  const auto = $derived(
    autoNote({
      sdm,
      auto: snap.state.rate === 0,
      outRate,
      filter: inUseFilter,
      source,
      shaper,
      rates: caps.rates.filter((r) => r.allowed).map((r) => r.rate),
      failedHere,
    }),
  );
  const other = $derived(otherMode(caps.modes, caps.mode.name));
  const seen = $derived(other.name ? caps.lastSeen[other.name] : undefined);
  const tabs = $derived(
    sdm
      ? [
          { label: "DSD", current: true },
          { label: "PCM", current: false },
        ]
      : [
          { label: "DSD", current: false },
          { label: "PCM", current: true },
        ],
  );
  let viewing = $state<"current" | "other">("current");
  $effect(() => {
    void caps.mode.name; // back to the mode in use whenever it changes
    viewing = "current";
  });

  let sheet: HTMLDialogElement;
  const playing = $derived(snap.status.state === 2);
  function switchMode() {
    sheet.close();
    if (other.name) void apply({ mode: other.name });
  }
</script>

<section class="card signal">
  <p class="path" aria-label="Signal path now">
    {#each steps as s, i (i)}{#if i}<span class="arrow" aria-hidden="true">→</span>{/if}<span class="step">{s}</span>{/each}
    <span class="health {playing ? speedClass : ''}">● {healthWord(speedClass, playing)}{playing ? ` ${speedText}` : ""}</span>
  </p>

  <div class="tabs" role="tablist" aria-label="Output mode">
    {#each tabs as t (t.label)}
      {@const disabled = !t.current && !other.offered}
      <button
        role="tab"
        aria-selected={(viewing === "current") === t.current}
        aria-disabled={disabled}
        class:on={(viewing === "current") === t.current}
        class:off={disabled}
        title={disabled ? "This HQPlayer doesn't offer it. That's set in HQPlayer itself (its output device and settings)." : ""}
        onclick={() => !disabled && (viewing = t.current ? "current" : "other")}
      >
        {t.label}
        {#if t.current}<span class="badge">in use</span>{:else if disabled}<span class="info" aria-label="Why not available"
            >i</span
          >{/if}
      </button>
    {/each}
  </div>

  {#if viewing === "current"}
    {@render filters()}
    {@render shaping()}
    {#if caps.rateSettable}
      <Picker
        label="Rate"
        items={rateItems}
        current={auto ? auto.text : formatRate(caps.rates.find((r) => r.index === snap.state.rate)?.rate ?? 0, caps.mode.name)}
        disabled={busy}
        onpick={(i) => pickRate(i as (typeof rateItems)[number], apply)}
      />
      {#if auto?.why}
        <div class="auto" class:warn={auto.warn}>
          <p>{auto.why}</p>
          {#if auto.fixed?.length}
            <div class="fixed">
              {#each auto.fixed as r (r)}
                <button class="chip" disabled={busy} onclick={() => apply({ rate: r })}
                  >Use {formatRate(r, caps.mode.name)}</button
                >
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
    <div class="foot"><button class="guide" onclick={onguide} disabled={busy}>Guide me</button></div>
  {:else}
    <div class="other">
      <p class="note">
        Not in use.
        {#if seen}Last seen in {other.label}: {seenWhen(seen.at)}. HQPlayer brings these back when you switch.
        {:else}hqpweb hasn't seen {other.label}'s settings yet. HQPlayer brings back its own when you switch.{/if}
      </p>
      {#if seen}
        <dl class="seen">
          <dt>1x</dt>
          <dd class="name">{seen.filter1x}</dd>
          <dt>Nx</dt>
          <dd class="name">{seen.filterNx}</dd>
          <dt>{other.label === "DSD" ? "Modulator" : "Dither"}</dt>
          <dd class="name">{seen.shaper}</dd>
          <dt>Rate</dt>
          <dd class="name">{formatRate(seen.rate, other.name ?? "")}</dd>
        </dl>
      {/if}
      <div class="foot">
        <button class="primary" disabled={busy} onclick={() => sheet.showModal()}>Switch to {other.label}</button>
        <span class="hint">Pauses about 5 s. Change its settings once you're there.</span>
      </div>
    </div>
  {/if}
</section>

<dialog bind:this={sheet} class="sheet" aria-label="Switch to {other.label}">
  <h3>Switch to {other.label}?</h3>
  <ol>
    {#if playing && resume === "roon-linked"}<li>Roon pauses the music.</li>
    {:else if playing}<li>HQPlayer pauses.</li>{/if}
    <li>HQPlayer switches to {other.label}. About 5 seconds.</li>
    <li>{other.label}'s own settings come back. Change them after if you like.</li>
    {#if playing && resume === "roon-linked"}<li>Roon carries on from the same spot.</li>
    {:else if playing && resume === "roon"}<li>
        It stays paused: press play in Roon to carry on. (Link Roon in Settings and hqpweb does this for you.)
      </li>
    {:else if playing}<li>Playback carries on.</li>{/if}
  </ol>
  <p class="hint">Switching while music plays can crash HQPlayer, so hqpweb always pauses first.</p>
  <div class="actions">
    <button onclick={() => sheet.close()}>Cancel</button>
    <button class="primary" onclick={switchMode}>Switch</button>
  </div>
</dialog>

<style>
  .card {
    background: var(--bg-elev);
    border-radius: 14px;
    overflow: hidden;
    margin-top: 10px;
  }
  .path {
    margin: 0;
    padding: 10px 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
  }
  .arrow {
    color: var(--text-faint);
  }
  .health {
    margin-left: auto;
    font-family: var(--font-sans);
    color: var(--ok);
  }
  .health.warn {
    color: var(--warn);
  }
  .health.bad {
    color: var(--danger);
  }
  .tabs {
    display: flex;
    background: var(--bg-elev-2);
  }
  .tabs button {
    flex: 1;
    min-height: 46px;
    font: inherit;
    font-weight: 600;
    border: 0;
    background: none;
    color: var(--text-dim);
    border-bottom: 3px solid transparent;
    cursor: pointer;
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .tabs button.off {
    color: var(--text-faint);
    cursor: not-allowed;
  }
  .badge {
    font-size: 0.7rem;
    padding: 2px 7px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-text);
    margin-left: 4px;
  }
  .info {
    display: inline-flex;
    width: 18px;
    height: 18px;
    border-radius: 9px;
    border: 1px solid currentColor;
    font-size: 0.7rem;
    align-items: center;
    justify-content: center;
    margin-left: 4px;
  }
  .auto {
    padding: 0 16px 10px;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .auto p {
    margin: 0;
  }
  .auto.warn {
    color: var(--warn);
  }
  .fixed {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .chip {
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
  .foot {
    padding: 10px 16px 14px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .guide,
  .primary {
    font: inherit;
    font-weight: 600;
    min-height: 46px;
    border-radius: 23px;
    border: 1px solid var(--accent);
    background: none;
    color: var(--accent-text);
    cursor: pointer;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .other .note {
    margin: 0;
    padding: 12px 16px;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .seen {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    padding: 0 16px 12px;
    opacity: 0.6;
  }
  .seen dt {
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .seen dd {
    margin: 0;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 0.9rem;
  }
  .hint {
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .sheet {
    border: 0;
    border-radius: 18px;
    padding: 20px;
    max-width: 26rem;
    background: var(--bg-elev);
    color: var(--text);
  }
  .sheet::backdrop {
    background: var(--bg-veil);
  }
  .sheet h3 {
    margin: 0 0 10px;
  }
  .sheet ol {
    margin: 0 0 10px;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }
  .actions button {
    flex: 1;
    font: inherit;
    font-weight: 600;
    min-height: 46px;
    border-radius: 23px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .actions .primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
</style>
