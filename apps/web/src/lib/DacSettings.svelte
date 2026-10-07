<script lang="ts">
  // Settings → Your setup → DACs: for an HQPlayer that plays to more than one DAC (a saved
  // HQPlayer profile for each, behind one Roon zone). HQPlayer can't tell an app which DAC
  // it's using, or switch to another, so the listener names them and picks the one in use.
  // The design is MusicD-Remote's (by meltface-80); the rules are the server's dac-scope.ts.
  import { api, type Inst } from "./api.ts";
  import { hasDacs } from "./dac-scope.ts";

  let { instance, onchange }: { instance: Inst | null; onchange: () => Promise<void> } = $props();

  let name = $state("");
  let busy = $state(false);
  let msg = $state<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    msg = null;
    try {
      await fn();
      await onchange();
    } catch (err) {
      msg = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  function add(e: Event) {
    e.preventDefault();
    const i = instance;
    const n = name.trim();
    if (!i || !n) return;
    // The first DAC gets a name too: a picker of "DAC" and "Desk DAC" says nothing.
    const current = hasDacs(i) ? undefined : (prompt("And the DAC you use now is called…", "First DAC")?.trim() ?? "");
    if (current === "") return;
    void run(async () => {
      await api.addDac(i.id, n, current);
      name = "";
    });
  }
  function rename(dac: { id: string; name: string }) {
    const n = prompt(`Rename ${dac.name}`, dac.name)?.trim();
    if (instance && n && n !== dac.name) void run(() => api.renameDac(instance!.id, dac.id, n));
  }
  function remove(dac: { id: string; name: string }) {
    if (instance && confirm(`Remove ${dac.name}? Its answers and failures go; its own presets become shared.`))
      void run(() => api.removeDac(instance!.id, dac.id));
  }
  const use = (dac: string) => instance && void run(() => api.selectDac(instance!.id, dac));
</script>

{#if instance?.source === "configured"}
  <div class="dacs">
    <strong>DACs</strong>
    <p class="help">
      For an HQPlayer that plays to more than one DAC, with a saved profile for each. HQPlayer can't tell hqpweb which one it's
      using, so name them here and choose the one in use whenever you switch in HQPlayer. Your answers below, the failures learned
      here and a DAC's own presets follow the choice.
    </p>
    {#if hasDacs(instance)}
      <ul>
        {#each instance.dacs as d (d.id)}
          <li class:now={d.id === instance.dac}>
            <span class="name">{d.name}</span>
            {#if d.id === instance.dac}<span class="inuse">In use</span>
            {:else}<button class="small" disabled={busy} onclick={() => use(d.id)}>Use</button>{/if}
            <button class="small" disabled={busy} onclick={() => rename(d)}>Rename</button>
            {#if d.id !== "main"}<button class="small" disabled={busy} onclick={() => remove(d)}>Remove</button>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    <form onsubmit={add}>
      <input bind:value={name} maxlength="64" placeholder="e.g. Desk DAC" aria-label="New DAC's name" />
      <button class="small" type="submit" disabled={busy || !name.trim()}>Add a DAC</button>
    </form>
    {#if msg}<p class="err" role="status">{msg}</p>{/if}
  </div>
{/if}

<style>
  .dacs {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    border-radius: 10px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .help {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .inuse {
    color: var(--ok);
    font-size: 0.85rem;
    font-weight: 600;
  }
  form {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text);
  }
  .small {
    font: inherit;
    font-size: 0.9rem;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: inherit;
    cursor: pointer;
  }
  .small:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .err {
    margin: 0;
    color: var(--danger);
    font-size: 0.85rem;
  }
</style>
