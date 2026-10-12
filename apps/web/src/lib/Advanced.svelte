<script lang="ts">
  // Advanced: convolution, and the options (mode, rate and matrix profile are on the signal card). These can stop
  // playback; the server checks that it recovers and tries to roll back if it doesn't.
  import type { ApplyResult, Change, Snapshot } from "./api.ts";

  let {
    snap,
    busy,
    apply,
    open = $bindable(),
  }: {
    snap: Snapshot;
    busy: boolean;
    apply: (change: Change) => Promise<ApplyResult | void>;
    open: boolean;
  } = $props();

  /** Apply a switch, then show what HQPlayer actually reports (it can say OK and not change). */
  const toggle = async (el: HTMLInputElement, key: "invert" | "filter20k" | "adaptive" | "convolution") => {
    await apply({ [key]: el.checked });
    el.checked = snap.state[key];
  };
</script>

<details class="advanced" bind:open>
  <summary>Advanced</summary>
  <p class="help">These can stop playback. The app checks that playback recovers, and tries to roll back if it doesn't.</p>

  <h2 class="sub-h">Convolution</h2>
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
  </section>
  <p class="help">
    Impulse responses are set up in HQPlayer itself (its Convolution menu); the control API can only switch convolution on and
    off. Matrix profiles are on the card above.
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
