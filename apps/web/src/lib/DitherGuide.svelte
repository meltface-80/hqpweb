<script lang="ts">
  // The dither guide: two questions, then the group to choose from, as equals. The
  // decisions are advice/dither.ts's; this only shows them.
  import type { Setup } from "./api.ts";
  import { ditherAdvice } from "./advice/dither.ts";
  import { RULES } from "./advice/policy.ts";
  import { SETUP_QUESTIONS, type SetupKey } from "./setup-questions.ts";
  import SetupStep from "./SetupStep.svelte";
  import RuleList from "./RuleList.svelte";

  let {
    setup,
    rateHz,
    rateText,
    names,
    warnings,
    current,
    disabled = false,
    onanswer,
    onpick,
    step,
  }: {
    setup: Setup;
    rateHz: number;
    rateText: string;
    names: string[];
    /** Warnings from the list, by name ("won't play here", "failed here before"). */
    warnings: Record<string, string>;
    current: string;
    disabled?: boolean;
    onanswer: (key: SetupKey, value: string) => Promise<void>;
    onpick: (name: string) => void;
    /** Show only this step (the v2 layout's guide flow); all of them when absent. */
    step?: number;
  } = $props();
  const show = (n: number) => step === undefined || step === n;

  const advice = $derived(ditherAdvice({ setup, rateHz, shapers: names }));
  const q = SETUP_QUESTIONS;
  const label = (key: SetupKey, v: string | undefined) => q[key].options.find((o) => o.value === v)?.label ?? "";
  const BITS = {
    ladder: "Set DAC Bits low in HQPlayer's settings (hqpweb can't read or set it).",
    default: "Leave DAC Bits at HQPlayer's default.",
    "24": "Set DAC Bits to 24 in HQPlayer's settings: S/PDIF carries 24 bits.",
    match: "Set DAC Bits in HQPlayer's settings to what your DAC takes over I2S.",
  };
</script>

<ol class="steps">
  {#if show(1)}<SetupStep
      n={1}
      title="Your DAC"
      question={q.pcm.question}
      help={q.pcm.help}
      options={q.pcm.options}
      current={setup.pcm}
      summary={label("pcm", setup.pcm)}
      onchoose={(v) => onanswer("pcm", v)}
    />{/if}
  {#if show(2)}<SetupStep
      n={2}
      title="The connection"
      off={advice.status === "needs-dac"}
      question={q.link.question}
      help={q.link.help}
      options={q.link.options}
      current={setup.link}
      summary={label("link", setup.link)}
      onchoose={(v) => onanswer("link", v)}
    />{/if}

  {#if !show(3)}<!-- the flow shows where to start as its last step -->
  {:else if advice.status === "needs-rate"}
    <li class="card">
      <div class="head">Where to start</div>
      <p>
        For a ladder DAC this depends on the output rate, which isn't known while stopped on auto. Play something, or set the rate
        under Advanced → Output rate.
      </p>
    </li>
  {:else if advice.status === "ok"}
    <li class="card">
      <div class="head">Where to start</div>
      {#if advice.group.length}
        <p class="sub">
          {advice.group.length > 1 ? "These are equals: try them by ear, in this order." : "This one suits your answers."}
        </p>
        <div class="alts">
          {#each advice.group as name (name)}
            <button
              class="chip"
              class:on={current === name}
              title={warnings[name]}
              {disabled}
              onclick={() => name !== current && onpick(name)}
              >{#if current === name}✓
              {:else if warnings[name]}⚠
              {/if}{name}</button
            >
          {/each}
        </div>
      {:else}
        <p>None of this HQPlayer's dithers fits these answers; pick one from the list.</p>
      {/if}
      <RuleList rules={advice.rules} />
      {#each advice.group.filter((n) => warnings[n]) as n (n)}<p class="note warn">⚠ {n}: {warnings[n]}</p>{/each}
      {#if advice.raiseRate}
        <p class="note">Now {rateText || "unknown"}: raise the rate under Advanced → Output rate if your DAC takes it.</p>
      {/if}
      {#if advice.bits}
        <p class="note">{BITS[advice.bits.kind]}</p>
        {#if advice.bits.rule}<RuleList rules={[advice.bits.rule]} />{/if}
      {/if}
      {#if advice.tryDsd}
        <p class="note">Your DAC takes DSD well: DSD output usually beats PCM. Try it under Advanced → Mode.</p>
        <RuleList rules={[advice.tryDsd]} />
      {/if}
      <RuleList rules={[RULES.neverNone]} />
    </li>
  {/if}
</ol>

<style>
  .steps {
    margin: 0;
    padding: 0 16px 16px;
    display: grid;
    gap: 10px;
  }
  .card {
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px;
    display: grid;
    gap: 6px;
  }
  .head {
    font-weight: 600;
  }
  p {
    margin: 0;
    font-size: 0.9rem;
  }
  .sub {
    color: var(--text-dim);
    font-size: 0.82rem;
  }
  .note {
    font-size: 0.82rem;
    color: var(--text-dim);
    background: var(--bg);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .note.warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  .alts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 40px;
    border-radius: 999px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: inherit;
  }
  .chip:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .on {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, var(--bg-elev));
  }
</style>
