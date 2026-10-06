<script lang="ts">
  // Rate and modulator pairs (advice/pairs.ts): each row is one change that sets both, in
  // an order that never passes through a pair that can't play (the server's job). What
  // this machine has done with a pair before is shown, never used to refuse it.
  import type { Pair } from "./advice/pairs.ts";
  import RuleList from "./RuleList.svelte";
  import { variantNote } from "./advice/variants.ts";

  type Choice = { rateHz: number; shaper: string };
  let {
    pairs,
    currentRate,
    current,
    disabled = false,
    check,
    onpick,
  }: {
    pairs: Pair[];
    /** The output rate now, in Hz (0 when unknown). */
    currentRate: number;
    /** The modulator now. */
    current: string;
    disabled?: boolean;
    /** What's known about a pair here: learned failures (information only). */
    check: (c: Choice) => { invalid: string | null; failedHere: string | null } | null;
    onpick: (c: Choice) => void;
  } = $props();

  const isNow = (c: Choice) => c.rateHz === currentRate && c.shaper === current;
</script>

<ul class="pairs">
  {#each pairs as p (p.label)}
    {@const c = { rateHz: p.rateHz, shaper: p.start.name }}
    {@const known = check(c)}
    <li class="pair" class:now={isNow(c)}>
      <p class="name">
        <strong>{p.label} · {p.start.name}</strong>
        <span class="badge" class:yours={!p.start.isDefault}>{p.start.isDefault ? "HQPlayer's default" : "For your answers"}</span
        >
        {#if p.suitsDac}<span class="badge suits">Suits your DAC</span>{/if}
      </p>
      <RuleList rules={p.start.rules} />
      {#if variantNote(p.start.name)}
        {@const v = variantNote(p.start.name)!}
        <p class="char">
          {#if v.load}CPU: {v.load}.{/if}
        </p>
        <RuleList rules={v.rules} />
      {/if}
      {#if known?.invalid}
        <!-- Pairs never break the modulator's floor; this is the filter's ratio: a warning, as elsewhere. -->
        <p class="note warn">⚠ With the filter in use: {known.invalid}. If playback stops, it's rolled back.</p>
      {:else if known?.failedHere}<p class="note warn">⚠ {known.failedHere}</p>{/if}
      <div class="actions">
        {#if isNow(c)}
          <span class="using">✓ Now using</span>
        {:else}
          <button class="primary" {disabled} onclick={() => onpick(c)}>Use</button>
        {/if}
      </div>
    </li>
  {/each}
</ul>

<style>
  .pairs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .pair {
    display: grid;
    gap: 4px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
  }
  .pair.now {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 8%, transparent);
  }
  .name {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .badge {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .badge.yours,
  .badge.suits {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
    color: var(--ok);
  }
  .char {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-dim);
  }
  .note {
    margin: 0;
    font-size: 0.82rem;
    border-radius: 10px;
    padding: 6px 10px;
  }
  .note.warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .using {
    color: var(--ok);
    font-weight: 600;
    font-size: 0.9rem;
  }
  button {
    font: inherit;
    cursor: pointer;
    min-height: 40px;
    border-radius: 10px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: inherit;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
    font-weight: 600;
  }
</style>
