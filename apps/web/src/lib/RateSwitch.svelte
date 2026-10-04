<script lang="ts">
  // Picking a filter that can't do the current conversion ratio: offer output rates
  // that can (HQPlayer's own list, checked against the filter's rule), Auto, or
  // applying anyway. Warn, never refuse (design: users own their choices).
  export type RateOption = { label: string; rate: number; nearest?: boolean };
  export type RateSwitchRequest = {
    /** pick: the user chose an incompatible filter. wedge: the queued track can't start. */
    kind: "pick" | "wedge";
    title: string;
    filter: string;
    /** Whether something is playing (so the change can be checked). */
    playing: boolean;
    /** wedge: a way out other than the rate, e.g. "Choose another filter". */
    alternative?: string;
    /** Why it can't, e.g. "sinc-M needs a power-of-two ratio; 44.1k → 192k is 4.35×". */
    reason: string;
    options: RateOption[];
    /** Auto is offered, and isn't the current setting. */
    auto: boolean;
  };
  let {
    request,
    onchoose,
    onalternative,
    oncancel,
  }: {
    request: RateSwitchRequest | null;
    /** A rate in Hz (0 = Auto), or null to apply the filter without changing the rate. */
    onchoose: (rate: number | null) => void;
    /** The alternative was chosen; the sheet closes first. */
    onalternative: () => void;
    oncancel: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  });
  const alternative = () => {
    dialog.close();
    onalternative();
  };
  const choose = (rate: number | null) => {
    dialog.close();
    onchoose(rate);
  };
</script>

<dialog bind:this={dialog} onclose={() => request && oncancel()} onclick={(e) => e.target === dialog && dialog.close()}>
  {#if request}
    <div class="sheet">
      <header>
        <h3>{request.title}</h3>
        <button class="close" onclick={() => dialog.close()} aria-label="Cancel"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button
        >
      </header>
      <p class="reason">{request.reason}.</p>
      {#if request.options.length || request.auto}
        <p class="label">Switch the output rate to</p>
        <div class="options">
          {#each request.options as o (o.rate)}
            <button class="option" class:nearest={o.nearest} onclick={() => choose(o.rate)}
              >{o.label}{#if o.nearest}<small>closest</small>{/if}</button
            >
          {/each}
          {#if request.auto}
            <button class="option" onclick={() => choose(0)}>Auto <small>HQPlayer chooses</small></button>
          {/if}
        </div>
      {:else}
        <p class="reason">None of this instance's output rates fit this filter from the current source.</p>
      {/if}
      {#if request.kind === "wedge"}
        <p class="note">Then press Play.</p>
      {:else if request.playing}
        <p class="note">Playback restarts briefly. If it doesn't recover, the change is rolled back.</p>
      {:else}
        <p class="note">Nothing's playing, so this can't be checked. If it doesn't fit, the next track won't start.</p>
      {/if}
      <div class="actions">
        {#if request.kind === "wedge"}
          {#if request.alternative}<button class="plain" onclick={alternative}>{request.alternative}</button>{/if}
        {:else}
          <button class="plain" onclick={() => choose(null)}>Apply anyway</button>
        {/if}
        <button class="plain" onclick={() => dialog.close()}>Cancel</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    padding: 0;
    border: 0;
    background: transparent;
    width: min(100%, 28rem);
    max-width: 100%;
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
    padding: 0 20px calc(16px + env(safe-area-inset-bottom));
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
    gap: 12px;
    padding: 18px 0 6px;
  }
  h3 {
    margin: 0;
    font-size: 1.25rem;
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
    flex: none;
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
  .reason {
    margin: 4px 0 12px;
    color: var(--text-dim);
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .label {
    margin: 8px 0 8px;
    font-size: 0.74rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-faint);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .option {
    font: inherit;
    font-weight: 600;
    padding: 10px 16px;
    border-radius: 12px;
    border: 0;
    background: var(--accent-soft);
    color: var(--accent-text);
    cursor: pointer;
  }
  .option.nearest {
    background: var(--accent);
    color: var(--on-accent);
  }
  .option.nearest small {
    color: inherit;
    opacity: 0.8;
  }
  .option small {
    font-weight: 400;
    color: var(--text-dim);
    margin-left: 4px;
  }
  .note {
    margin: 14px 0 6px;
    font-size: 0.8rem;
    color: var(--text-faint);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    border-top: 1px solid var(--border);
    margin-top: 10px;
    padding-top: 8px;
  }
  .plain {
    font: inherit;
    background: none;
    border: 0;
    padding: 10px 12px;
    color: var(--text-dim);
    cursor: pointer;
  }
</style>
