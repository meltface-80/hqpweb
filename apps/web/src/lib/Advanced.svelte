<script lang="ts">
  // Advanced: mode, output rate, convolution and matrix, and the options. These can stop
  // playback; the server checks that it recovers and tries to roll back if it doesn't.
  import Picker from "./Picker.svelte";
  import { formatRate, type ApplyResult, type Capabilities, type Change, type Snapshot } from "./api.ts";
  import type { rateItems as rateItemsOf } from "./hints.ts";

  let {
    caps,
    snap,
    busy,
    rateItems,
    apply,
    open = $bindable(),
  }: {
    caps: Capabilities;
    snap: Snapshot;
    busy: boolean;
    rateItems: ReturnType<typeof rateItemsOf>;
    apply: (change: Change) => Promise<ApplyResult | void>;
    open: boolean;
  } = $props();

  const applyMajor = (what: string, change: Change) => {
    const ok = confirm(
      `Change ${what}?\n\nPlayback may pause for a few seconds. If it doesn't recover, the change is rolled back automatically.`,
    );
    if (ok) void apply(change); // apply reports its own errors in the footer
  };
  /** Apply a switch, then show what HQPlayer actually reports (it can say OK and not change). */
  const toggle = async (el: HTMLInputElement, key: "invert" | "filter20k" | "adaptive" | "convolution") => {
    await apply({ [key]: el.checked });
    el.checked = snap.state[key];
  };
</script>

<details class="advanced" bind:open>
  <summary>Advanced</summary>
  <p class="help">These can stop playback. The app checks that playback recovers, and tries to roll back if it doesn't.</p>
  <section class="card list">
    <Picker
      label="Mode"
      items={caps.modes}
      current={caps.mode.name}
      disabled={busy}
      onpick={(i) => applyMajor(`mode to ${i.name}`, { mode: i.name })}
    />
    {#if caps.rateSettable}
      <Picker
        label="Output rate"
        hint={snap.state.rate === 0 ? `now ${formatRate(snap.status.activeRate, caps.mode.name)}` : ""}
        items={rateItems}
        current={formatRate(caps.rates.find((r) => r.index === snap!.state.rate)?.rate ?? 0, caps.mode.name)}
        disabled={busy}
        onpick={(i) => applyMajor(`output rate to ${i.name}`, { rate: (i as (typeof rateItems)[number]).rate })}
      />
    {/if}
  </section>

  <h2 class="sub-h">Convolution and matrix</h2>
  <section class="card list">
    <label class="toggle">
      <span>Convolution</span>
      <input
        type="checkbox"
        role="switch"
        checked={snap.state.convolution}
        disabled={busy}
        onchange={(e) => toggle(e.currentTarget, "convolution")}
      />
    </label>
    {#if caps.matrixProfiles.length}
      <Picker
        label="Matrix profile"
        items={caps.matrixProfiles.map((name, index) => ({ index, name }))}
        current={snap.state.matrixProfile}
        disabled={busy}
        onpick={(i) => apply({ matrixProfile: i.name })}
      />
    {/if}
  </section>
  <p class="help">
    Impulse responses and matrix profiles are set up in HQPlayer itself (its Convolution and Matrix menus); the control API can
    only switch them.
    {#if !caps.matrixProfiles.length}No matrix profiles are set up on this instance.{/if}
  </p>

  <h2 class="sub-h">Options</h2>
  <section class="card list">
    {#each [["invert", "Invert polarity"], ["filter20k", "20 kHz filter"], ["adaptive", "Adaptive volume"]] as [key, label] (key)}
      {@const k = key as "invert" | "filter20k" | "adaptive"}
      <label class="toggle">
        <span>{label}</span>
        <input
          type="checkbox"
          role="switch"
          checked={snap.state[k]}
          disabled={busy}
          onchange={(e) => toggle(e.currentTarget, k)}
        />
      </label>
    {/each}
  </section>
</details>

<style>
  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin: 22px 4px 8px;
    font-weight: 600;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    cursor: pointer;
  }
  .toggle:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }
  .toggle input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent-text);
  }
  .advanced {
    margin-top: 22px;
  }
  .advanced summary {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    font-weight: 600;
    padding: 0 4px;
    cursor: pointer;
  }
  .advanced .help {
    margin: 8px 4px;
  }
  .sub-h {
    margin-top: 14px;
  }
  /* Shared with App.svelte (styles are scoped per component). */
  .card {
    background: var(--bg-elev);
    border-radius: 14px;
  }
  .card.list {
    overflow: hidden;
  }
  .help {
    color: var(--text-dim);
    font-size: 0.82rem;
    margin: 6px 4px 0;
  }
</style>
