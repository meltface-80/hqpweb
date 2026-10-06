<script lang="ts">
  // The modulator guide: three questions, then where to start. The decisions are
  // advice/modulator.ts's; this only shows them. Names come from this HQPlayer's own list.
  import type { Setup } from "./api.ts";
  import { modulatorAdvice } from "./advice/modulator.ts";
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
    processSpeed,
    current,
    disabled = false,
    onanswer,
    onpick,
  }: {
    setup: Setup;
    rateHz: number;
    /** The output rate as the app shows it, e.g. "DSD256". */
    rateText: string;
    names: string[];
    /** Warnings from the list, by name ("won't play here", "failed here before"). */
    warnings: Record<string, string>;
    processSpeed: number | null;
    current: string;
    disabled?: boolean;
    onanswer: (key: SetupKey, value: string) => Promise<void>;
    onpick: (name: string) => void;
  } = $props();

  const advice = $derived(modulatorAdvice({ setup, rateHz, modulators: names, processSpeed }));
  const q = SETUP_QUESTIONS;
  const label = (key: SetupKey, v: string | undefined) => q[key].options.find((o) => o.value === v)?.label ?? "";
  // Yes/No answers read better as their description, e.g. "Any other kind."
  const described = (key: SetupKey, v: string | undefined) => q[key].options.find((o) => o.value === v)?.description ?? "";

  // Compare: A is the starting point, B what was playing when Compare was pressed.
  let compareB = $state<string | null>(null);
  const comparing = $derived(!!compareB && advice.start !== null && compareB !== advice.start.name);
  function compare() {
    if (!advice.start || !current) return;
    compareB = current;
    onpick(advice.start.name);
  }
  const startIsAhm = $derived(advice.start?.name.startsWith("AHM") ?? false);
  const p512Name = $derived(advice.start ? `${advice.start.name} 512+fs` : "");
</script>

<ol class="steps">
  <SetupStep
    n={1}
    title="Your DAC"
    question={q.dsd.question}
    help={q.dsd.help}
    options={q.dsd.options}
    current={setup.dsd}
    summary={`${label("dsd", setup.dsd)}: ${advice.status === "use-pcm" ? "PCM output suits it." : `order ${advice.order}.`}`}
    onchoose={(v) => onanswer("dsd", v)}
  >
    {#snippet after()}
      {#if advice.status === "use-pcm"}
        <p class="note">
          Your DAC converts DSD, so PCM output usually sounds better. Switch to PCM under Advanced → Mode, then choose a dither.
        </p>
        <RuleList rules={[RULES.usePcm]} />
      {/if}
    {/snippet}
  </SetupStep>
  <SetupStep
    n={2}
    title="Your amplifier"
    off={advice.status === "needs-dac"}
    question={q.amp.question}
    help={q.amp.help}
    options={q.amp.options}
    current={setup.amp}
    summary={described("amp", setup.amp)}
    onchoose={(v) => onanswer("amp", v)}
  />
  <SetupStep
    n={3}
    title="Your volume"
    off={advice.status === "needs-dac"}
    question={q.volume.question}
    help={q.volume.help}
    options={q.volume.options}
    current={setup.volume}
    summary={described("volume", setup.volume)}
    onchoose={(v) => onanswer("volume", v)}
  />

  {#if advice.status === "ok"}
    <li class="card">
      <div class="head">Rate</div>
      {#if advice.suggestedRate}
        <p>
          {advice.suggestedRate.label} suits {setup.dsd === "remodulates"
            ? "a newer ESS chip"
            : "your DAC"}{#if advice.suggestedRate.orDsd512}, or DSD512 to cut ultrasonic noise further{/if}{#if advice.suggestedRate.orDsd1024},
            or DSD1024 with an AHM modulator{/if}. Now: {rateText || "unknown"}. Change it under Advanced → Output rate.
        </p>
        <RuleList rules={advice.suggestedRate.rules} />
      {:else}
        <p>Now: {rateText || "unknown"}.</p>
      {/if}
      {#if !advice.rateKnown}
        <p class="note">
          The rate isn't known while stopped on auto, so this assumes below DSD1024. Play something to update it.
        </p>
      {/if}
    </li>

    <li class="card">
      <div class="head">Where to start</div>
      {#if advice.start}
        <p class="start">
          <strong>{advice.start.name}</strong>
          <span class="badge" class:yours={!advice.start.isDefault}
            >{advice.start.isDefault ? "HQPlayer's default" : "For your answers"}</span
          >
        </p>
        <RuleList rules={advice.start.rules} />
        {#if warnings[advice.start.name]}<p class="note warn">⚠ {warnings[advice.start.name]}</p>{/if}
        <div class="actions">
          {#if current === advice.start.name}
            <span class="using">✓ Now using</span>
          {:else}
            <button class="primary" {disabled} onclick={() => onpick(advice.start!.name)}>Use {advice.start.name}</button>
            <button class="secondary" disabled={disabled || !current} onclick={compare}>Compare with what's playing</button>
          {/if}
        </div>
        {#if comparing}
          <div class="ab" role="group" aria-label="Compare">
            <button class:on={current === advice.start.name} {disabled} onclick={() => onpick(advice.start!.name)}
              >A · {advice.start.name}</button
            >
            <button class:on={current === compareB} {disabled} onclick={() => onpick(compareB!)}>B · {compareB}</button>
          </div>
        {/if}
        {#if advice.p512.offered && names.includes(p512Name)}
          <!-- Only when the start isn't already the 512+fs version, i.e. it isn't suggested. -->
          <p class="note">{p512Name} is also offered at this rate; it matters when HQPlayer turns the volume well down.</p>
        {/if}
        {#if advice.alternatives.length}
          {#if startIsAhm}
            <p class="sub">The other AHM versions, to compare by ear:</p>
          {:else}
            <p class="sub">Other characters to try, by ear (they're equals, not a ranking):</p>
            <RuleList rules={[RULES.variantsEqual]} />
          {/if}
          <div class="alts">
            {#each advice.alternatives as a (a.name)}
              <button
                class="chip"
                class:on={current === a.name}
                title={warnings[a.name]}
                {disabled}
                onclick={() => onpick(a.name)}
                >{#if warnings[a.name]}⚠
                {/if}{a.name}</button
              >
            {/each}
          </div>
        {/if}
      {:else}
        <p>None of this HQPlayer's modulators fits these answers; pick one from the list.</p>
      {/if}
      {#if advice.machine && advice.machine.state !== "keeps-up"}
        <p class="note warn">
          {advice.machine.state === "behind"
            ? "HQPlayer is falling behind at these settings. A lower rate or a lighter filter helps most; a lighter variant only a little."
            : "HQPlayer is only just keeping up. If playback stutters, a lower rate or a lighter filter helps most."}
        </p>
        <RuleList rules={[advice.machine.rule]} />
      {/if}
      {#if advice.unknown.length}
        <p class="note">
          This HQPlayer also lists {advice.unknown.join(", ")}, newer than hqpweb's advice. They're in the list.
        </p>
      {/if}
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
  .start {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
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
  .badge.yours {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
    color: var(--ok);
  }
  .actions,
  .alts,
  .ab {
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
  .chip {
    border-radius: 999px;
    font-size: 0.85rem;
  }
  .on {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, var(--bg-elev));
  }
</style>
