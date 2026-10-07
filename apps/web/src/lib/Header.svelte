<script lang="ts">
  // The top bar: the app, the instance (with its status dot) and Settings; under it, with
  // more than one named DAC behind the instance, which DAC is in use (dac-scope.ts).
  import { api, type Inst } from "./api.ts";
  import { hasDacs } from "./dac-scope.ts";

  let {
    instances,
    selected = $bindable(),
    online,
    slow,
    dotTitle,
    onsettings,
    ondacs,
  }: {
    instances: Inst[];
    selected: string | null;
    online: "connecting" | "live" | "unreachable" | "lost";
    slow: boolean;
    dotTitle: string;
    onsettings: () => void;
    /** After the DAC in use changes, so the instance list (and its answers) catch up. */
    ondacs: () => Promise<void>;
  } = $props();

  const inst = $derived(instances.find((i) => i.id === selected) ?? null);
  let dacMsg = $state("");
  async function pickDac(e: Event) {
    const dac = (e.currentTarget as HTMLSelectElement).value;
    if (!inst || dac === inst.dac) return;
    dacMsg = "";
    try {
      await api.selectDac(inst.id, dac);
    } catch (err) {
      dacMsg = (err as Error).message; // e.g. a change is still running
    }
    await ondacs();
  }

  const optionLabel = (i: Inst) =>
    `${i.reachable === false ? "⚠ " : ""}${i.name}${i.source === "discovered" ? " (discovered)" : ""}`;
</script>

<header class="top">
  <span class="brand" aria-label="hqpweb"><img src="/icon-192.png" alt="" width="22" height="22" />hqpweb</span>
  <!-- The status dot sits on the instance name it belongs to. -->
  <div class="inst" title={dotTitle}>
    <span class="dot {online}" class:slow={online === "live" && slow} aria-hidden="true"></span>
    {#if instances.length > 1}
      <select bind:value={selected} aria-label="Instance">
        {#each instances as i (i.id)}<option value={i.id}>{optionLabel(i)}</option>{/each}
      </select>
    {:else}
      <h1>{instances[0] ? optionLabel(instances[0]) : "No instances"}</h1>
    {/if}
  </div>
  <button class="gear" onclick={onsettings} aria-label="Settings">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
      ><path
        fill="currentColor"
        d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
        transform="translate(-1 0)"
      /></svg
    >
  </button>
</header>
{#if inst && hasDacs(inst)}
  <div class="dacrow">
    <label
      >DAC
      <select value={inst.dac} onchange={pickDac} aria-label="DAC in use">
        {#each inst.dacs as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
      </select></label
    >
    {#if dacMsg}<span class="dacmsg" role="status">{dacMsg}</span>{/if}
  </div>
{/if}

<style>
  .dacrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: -4px 0 12px;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .dacrow select {
    font: inherit;
    margin-left: 6px;
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text);
  }
  .dacmsg {
    color: var(--warn);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .top h1 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gear {
    background: none;
    border: 0;
    color: var(--text-dim);
    padding: 8px;
    margin: -8px -8px -8px 0;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    display: grid;
    place-items: center;
  }
  .top select {
    flex: 1;
    min-width: 0;
    width: 100%;
    font: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: inherit;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-dim);
    flex: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-dim);
    font-size: 0.95rem;
    flex: none;
  }
  .brand img {
    border-radius: 6px;
  }
  .inst {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot.live {
    background: var(--ok);
  }
  .dot.live.slow {
    background: var(--warn);
  }
  .dot.unreachable,
  .dot.lost {
    background: var(--danger);
  }
</style>
