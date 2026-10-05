<script lang="ts">
  // Settings → Instances: the configured and discovered HQPlayer instances, scan, and add.
  import { api, type Inst } from "./api.ts";

  let { instances, onchange }: { instances: Inst[]; onchange: () => Promise<void> } = $props();

  let addName = $state("");
  let addHost = $state("");
  let addPort = $state(4321);
  let instMsg = $state<{ kind: "ok" | "error"; text: string } | null>(null);
  let scanning = $state(false);

  async function addInstance(e: SubmitEvent) {
    e.preventDefault();
    instMsg = null;
    try {
      await api.addInstance({ name: addName, host: addHost, port: addPort });
      await onchange();
      const added = instances.find((i) => i.host === addHost.trim() && i.port === addPort);
      instMsg =
        added?.reachable === false
          ? {
              kind: "error",
              text: `Added, but it doesn't answer yet (${added.error ?? "unreachable"}). Check host, port and firewall.`,
            }
          : { kind: "ok", text: "Added." };
      addName = addHost = "";
      addPort = 4321;
    } catch (err) {
      instMsg = { kind: "error", text: (err as Error).message };
    }
  }

  async function rename(i: Inst) {
    const name = prompt(`Rename ${i.name}`, i.name)?.trim();
    if (!name || name === i.name) return;
    try {
      await api.renameInstance(i.id, name);
      await onchange();
    } catch (err) {
      instMsg = { kind: "error", text: (err as Error).message };
    }
  }

  async function remove(i: Inst) {
    if (!confirm(`Remove ${i.name} (${i.host}:${i.port})?`)) return;
    await api.removeInstance(i.id);
    await onchange();
  }

  async function keep(i: Inst) {
    try {
      await api.addInstance({ name: i.name, host: i.host, port: i.port });
      await onchange();
    } catch (err) {
      instMsg = { kind: "error", text: (err as Error).message };
    }
  }

  async function scan() {
    scanning = true;
    instMsg = null;
    try {
      const found = (await api.discover()).filter((i) => i.discovered);
      await onchange();
      if (found.length === 0)
        instMsg = {
          kind: "error",
          text: "Scan found no HQPlayer. Scanning needs Docker host networking and multicast on your network (see README → Options); add by address instead.",
        };
    } catch (err) {
      instMsg = { kind: "error", text: (err as Error).message };
    } finally {
      scanning = false;
    }
  }
</script>

<h4>Instances</h4>
<ul class="instances">
  {#each instances as i (i.id)}
    <li>
      <div class="inst-main">
        <b>{i.name}</b>
        <small>{i.host}:{i.port}{i.engine ? ` · engine ${i.engine}` : ""}</small>
        <small>
          {#if i.reachable === false}<span class="bad">⚠ unreachable ({i.error})</span>
          {:else if i.reachable}<span class="good">✓ answering</span>{/if}
          · {i.source === "discovered"
            ? "found on the network"
            : i.discovered
              ? "configured · also found on the network"
              : "configured · not seen by discovery"}
        </small>
      </div>
      {#if i.source === "configured"}
        <button class="small" onclick={() => rename(i)}>Rename</button>
        <button class="small" onclick={() => remove(i)}>Remove</button>
      {:else}
        <button class="small" onclick={() => keep(i)}>Save</button>
      {/if}
    </li>
  {:else}
    <li class="empty">No instances yet. Scan, or add one below.</li>
  {/each}
</ul>
<p class="help">
  Discovery only sees HQPlayer on this server's own network segment; add instances on other VLANs or subnets by hand. “Not seen by
  discovery” is normal for those.
</p>
<button class="small" onclick={scan} disabled={scanning}>{scanning ? "Scanning…" : "Scan now"}</button>

<form class="add" onsubmit={addInstance}>
  <input
    bind:value={addName}
    placeholder="Name (optional)"
    maxlength="64"
    aria-label="Name"
    title="Leave blank to use the name HQPlayer reports"
  />
  <input
    bind:value={addHost}
    placeholder="Host or IP"
    required
    aria-label="Host"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
  />
  <input bind:value={addPort} type="number" min="1" max="65535" aria-label="Port" class="port" />
  <button class="small" type="submit">Add</button>
</form>
{#if instMsg}<p class={instMsg.kind === "error" ? "err" : "help"}>{instMsg.text}</p>{/if}

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
  }
  .instances {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .instances li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .instances li.empty {
    color: var(--text-dim);
  }
  .inst-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .inst-main small {
    color: var(--text-dim);
    overflow-wrap: anywhere;
  }
  .good {
    color: var(--ok);
  }
  .bad {
    color: var(--warn);
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
  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
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
</style>
