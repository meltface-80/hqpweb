<script lang="ts">
  // One numbered step of a guide that asks a setup question. Answered, it shows a one-line
  // summary and "Change", which reopens the choices in place with the answer highlighted.
  import type { Snippet } from "svelte";

  type Option = { value: string; label: string; description: string };
  let {
    n,
    title,
    off = false,
    summary,
    question,
    help = "",
    options,
    current,
    onchoose,
    extra,
    after,
  }: {
    n: number;
    title: string;
    /** Greyed out until an earlier question is answered. */
    off?: boolean;
    /** Shown when answered, e.g. "Older ESS chip: fifth order, DSD512." */
    summary: string;
    question: string;
    help?: string;
    options: readonly Option[];
    current: string | undefined;
    onchoose: (value: string) => Promise<void> | void;
    /** Under the choices while they're open (e.g. Find your DAC). */
    extra?: Snippet;
    /** Under the summary once answered (e.g. "Use PCM"). */
    after?: Snippet;
  } = $props();

  let editing = $state(false);
  let saving = $state(false);
  const answered = $derived(current !== undefined);
  const open = $derived(!off && (!answered || editing));

  async function choose(v: string) {
    saving = true;
    try {
      await onchoose(v);
      editing = false;
    } finally {
      saving = false;
    }
  }
</script>

<li class="step" class:done={answered && !editing} class:off>
  <div class="head">
    <span class="n" aria-hidden="true">{answered && !editing ? "✓" : n}</span>
    <span class="title">{title}</span>
  </div>
  {#if off}
    <p class="dim">{question}</p>
  {:else if open}
    <p>{question}</p>
    {#if help}<p class="help">{help}</p>{/if}
    <div class="choices" role="group" aria-label={title}>
      {#each options as o (o.value)}
        <button class="choice" class:sel={o.value === current} disabled={saving} onclick={() => choose(o.value)}>
          <span class="label">{o.label}</span>
          <span class="desc">{o.description}</span>
        </button>
      {/each}
    </div>
    {#if editing}<button class="link" onclick={() => (editing = false)}>Cancel</button>{/if}
    {@render extra?.()}
  {:else}
    <p>{summary} <button class="link" onclick={() => (editing = true)}>Change</button></p>
    {@render after?.()}
  {/if}
</li>

<style>
  .step {
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px;
    display: grid;
    gap: 6px;
  }
  .step.off {
    opacity: 0.55;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .n {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    background: var(--bg);
    color: var(--text-dim);
    flex: none;
  }
  .done .n {
    background: var(--ok);
    color: var(--bg-elev);
  }
  p {
    margin: 0;
    font-size: 0.9rem;
  }
  .dim {
    color: var(--text-dim);
  }
  .help {
    color: var(--text-dim);
    font-size: 0.82rem;
    background: var(--bg);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .choices {
    display: grid;
    gap: 6px;
  }
  .choice {
    display: grid;
    gap: 2px;
    text-align: left;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: inherit;
    font: inherit;
    cursor: pointer;
    min-height: 44px;
  }
  .choice.sel {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, var(--bg-elev));
  }
  .choice:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .label {
    font-weight: 600;
  }
  .desc {
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    justify-self: start;
  }
</style>
