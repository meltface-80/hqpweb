<script lang="ts">
  // Optional Roon link: off by default. When on, the Now card shows Roon's
  // now-playing for the zone mapped to this instance, with working transport.
  import { onDestroy } from "svelte";
  import { api, type FoundCore, type RoonView } from "./api.ts";

  let { instances }: { instances: { id: string; name: string }[] } = $props();

  let view = $state<RoonView | null>(null);
  let host = $state("");
  let port = $state(9330);
  let found = $state<FoundCore[] | null>(null);
  let finding = $state(false);
  let msg = $state("");
  let timer: ReturnType<typeof setTimeout> | undefined;

  export async function refresh() {
    clearTimeout(timer);
    try {
      view = await api.roon();
      if (!host && view.host) host = view.host;
      if (view.port) port = view.port;
      // Keep checking while waiting on the core or on approval in Roon.
      if (view.enabled && view.status !== "connected") timer = setTimeout(refresh, 2000);
    } catch (e) {
      msg = (e as Error).message;
    }
  }
  /** The sheet closed: stop checking. */
  export function stop() {
    clearTimeout(timer);
  }
  onDestroy(stop);

  async function configure(body: { enabled?: boolean; host?: string; port?: number }) {
    msg = "";
    try {
      view = await api.configureRoon(body);
      refresh();
    } catch (e) {
      msg = (e as Error).message;
    }
  }

  async function find() {
    finding = true;
    msg = "";
    try {
      found = await api.discoverRoon();
      if (found.length === 1) {
        host = found[0]!.host;
        port = found[0]!.port;
      }
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      finding = false;
    }
  }

  async function pickZone(instanceId: string, zone: string) {
    try {
      view = await api.setRoonZone(instanceId, zone || null);
    } catch (e) {
      msg = (e as Error).message;
    }
  }

  const STATUS: Record<RoonView["status"], string> = {
    off: "Off",
    connecting: "Connecting…",
    unapproved: "Waiting for approval in Roon",
    connected: "Connected",
    unreachable: "Can't reach the core; retrying",
  };
</script>

<h4>Roon (optional)</h4>
<label class="row">
  <span>Show Roon's now playing and controls</span>
  <input
    type="checkbox"
    role="switch"
    checked={view?.enabled ?? false}
    onchange={(e) => configure({ enabled: e.currentTarget.checked })}
  />
</label>
<p class="help">For HQPlayer fed by Roon. Everything else works without it.</p>

{#if view?.enabled}
  <form
    class="add"
    onsubmit={(e) => {
      e.preventDefault();
      configure({ host, port });
    }}
  >
    <input
      bind:value={host}
      placeholder="Roon Core host or IP"
      required
      aria-label="Roon Core host"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
    />
    <input bind:value={port} type="number" min="1" max="65535" aria-label="Roon Core port" class="port" />
    <button class="small" type="submit">Connect</button>
    <button class="small" type="button" onclick={find} disabled={finding}>{finding ? "Finding…" : "Find"}</button>
  </form>
  {#if found && found.length > 1}
    <ul class="found">
      {#each found as c (c.host + c.port)}
        <li>
          <button class="small" onclick={() => ((host = c.host), (port = c.port))}>{c.name ?? c.host} · {c.host}:{c.port}</button>
        </li>
      {/each}
    </ul>
  {:else if found && found.length === 0}
    <p class="help">
      No core found. Finding needs Docker host networking and the core on the same network segment; enter its address instead (the
      port is usually 9330).
    </p>
  {/if}

  <p class="status s-{view.status}">
    {STATUS[view.status]}{view.core ? ` · ${view.core.name} (${view.core.version})` : ""}{view.error &&
    view.status !== "connected"
      ? ` · ${view.error}`
      : ""}
  </p>
  {#if view.status === "unapproved"}
    <p class="help">In Roon, open Settings → Extensions and enable <b>{view.extensionName}</b>.</p>
  {/if}

  {#if view.status === "connected" && instances.length}
    {@const hqZones = view.zones.filter((z) => z.hqplayer)}
    <p class="help">Which Roon zone feeds each HQPlayer? Roon doesn't say, so pick once.</p>
    {#if !hqZones.length}
      <p class="help">This core has no zones that output through HQPlayer.</p>
    {/if}
    {#each instances as inst (inst.id)}
      {@const current = view.zoneFor[inst.id] ?? ""}
      {@const currentZone = view.zones.find((z) => z.id === current)}
      <label class="zone">
        <span>{inst.name}</span>
        <select value={current} onchange={(e) => pickZone(inst.id, e.currentTarget.value)}>
          <option value="">None</option>
          {#if current && !hqZones.some((z) => z.id === current)}<option value={current}
              >{currentZone ? `${currentZone.name} (not via HQPlayer)` : "(zone not on this core)"}</option
            >{/if}
          {#each hqZones as z (z.id)}<option value={z.id}>{z.name}</option>{/each}
        </select>
      </label>
    {/each}
  {/if}
{/if}
{#if msg}<p class="err">{msg}</p>{/if}

<style>
  h4 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text);
    font-weight: 700;
    margin: 18px 0 8px;
  }
  .help {
    color: var(--text-dim);
    font-size: 0.85rem;
    margin: 0 0 8px;
  }
  .err {
    color: var(--danger);
    font-size: 0.85rem;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    cursor: pointer;
  }
  .row input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 0 8px;
  }
  .add input {
    flex: 1 1 8rem;
    min-width: 0;
    padding: 9px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .add input.port {
    flex: 0 0 5.5rem;
  }
  .small {
    font: inherit;
    font-size: 0.9rem;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--accent-text);
    cursor: pointer;
    min-height: 40px;
  }
  .found {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .status {
    font-size: 0.9rem;
    margin: 4px 0 8px;
  }
  .s-connected {
    color: var(--ok);
  }
  .s-unapproved,
  .s-connecting {
    color: var(--warn);
  }
  .s-unreachable {
    color: var(--danger);
  }
  .zone {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 8px 0;
    font-size: 0.9rem;
  }
  .zone select {
    font: inherit;
    padding: 9px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
  }
</style>
