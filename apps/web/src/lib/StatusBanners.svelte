<script lang="ts">
  // The warnings above the Now card: no instances, falling behind, answering slowly,
  // unreachable (with restart steps, recovery.ts), and a lost connection to the app's server.
  import type { RestartSteps } from "./recovery.ts";

  let {
    noInstances,
    fallingBehind,
    speed,
    lastChange,
    undoAvailable,
    slowMs,
    online,
    offlineReason,
    restart,
  }: {
    noInstances: boolean;
    fallingBehind: boolean;
    /** Processing speed, × real time (HQPlayer's own, else hqpweb's position fit). */
    speed: number | null;
    /** The time of the last change that could overload HQPlayer, if recent. */
    lastChange: string | null;
    undoAvailable: boolean;
    /** HQPlayer's reply time when it's answering slowly, else null. */
    slowMs: number | null;
    online: string;
    offlineReason: string;
    restart: RestartSteps;
  } = $props();
</script>

{#if noInstances}
  <p class="banner warn">No HQPlayer instances yet. Open Settings (⚙) to scan the network or add one by address.</p>
{/if}

{#if fallingBehind}
  <p class="banner warn">
    HQPlayer is falling behind real time ({speed?.toFixed(2)}×): it may be overloaded.
    {#if lastChange}Your last change was at {lastChange}.{/if}
    {#if undoAvailable}Undo the last change below, or pick a lighter filter or modulator.{:else}Try a lighter filter or modulator.{/if}
  </p>
{/if}
{#if slowMs !== null}
  <p class="banner warn">
    HQPlayer is answering slowly ({slowMs} ms); it may be overloaded.
    {#if lastChange}Your last change was at {lastChange}{#if undoAvailable}: Undo it below while HQPlayer still answers{/if}.{/if}
  </p>
{/if}

{#if online === "unreachable"}
  <div class="banner error">
    <p>HQPlayer unreachable: {offlineReason}</p>
    <details>
      <summary>If it doesn't come back within a minute</summary>
      <p>It may be overloaded, or stopped. Restart it:</p>
      <ul>
        {#each restart.steps as s (s)}<li>{s}</li>{/each}
      </ul>
      <p>{restart.after}</p>
    </details>
  </div>
{:else if online === "lost"}
  <p class="banner warn">Lost connection to the app's server; retrying…</p>
{/if}

<style>
  .banner {
    padding: 10px 14px;
    border-radius: 10px;
    margin: 0 0 12px;
  }
  .banner p {
    margin: 0;
  }
  .banner details {
    margin-top: 6px;
    color: var(--text);
  }
  .banner summary {
    cursor: pointer;
    font-weight: 600;
    color: inherit;
  }
  .banner ul {
    margin: 4px 0;
    padding-left: 1.2rem;
  }
  .banner li {
    overflow-wrap: anywhere;
  }
  .banner.error {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
  }
  .banner.warn {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    color: var(--warn);
  }
</style>
