<script lang="ts">
  // The guide flow's top (canvas D2): Exit guide, what's playing, progress, and the step.
  import type { FlowStep } from "./guide-flow.ts";

  let {
    label,
    steps,
    step,
    rateText,
    current,
    onexit,
  }: { label: string; steps: FlowStep[]; step: number; rateText: string; current: string; onexit: () => void } = $props();
</script>

<header>
  <button class="exit" onclick={onexit}>Exit guide</button>
  <span class="now">Now {rateText || "—"} · <strong class="mono">{current || "—"}</strong></span>
</header>
<div class="progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step}>
  {#each steps as s, i (s.title)}<span class:done={i < step}></span>{/each}
</div>
<p class="stepname">{label} · {step} of {steps.length}: {steps[step - 1]?.title}</p>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 16px 0;
  }
  .now {
    font-size: 0.85rem;
    color: var(--text-dim);
    text-align: right;
  }
  .mono {
    font-family: var(--font-mono);
    font-weight: 500;
  }
  .exit {
    font: inherit;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .progress {
    display: flex;
    gap: 6px;
    margin: 12px 16px 0;
  }
  .progress span {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
  }
  .progress span.done {
    background: var(--accent);
  }
  .stepname {
    margin: 8px 16px 4px;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
</style>
