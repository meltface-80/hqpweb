<script lang="ts">
  // Restart recovery for the selected HQPlayer (server restart-guard.ts): after HQPlayer
  // restarts at its saved volume, hqpweb lowers it to this cap. Never raises. Saved on the
  // server, which acts with no page open.
  import { api, type Inst } from "./api.ts";

  let { instance, onchange }: { instance: Inst | null; onchange: () => Promise<void> } = $props();

  let draft = $state<number | null>(null);
  let error = $state("");
  let saving = $state(false);
  const on = $derived(instance?.restartVolumeCap !== undefined);
  const value = $derived(draft ?? instance?.restartVolumeCap ?? -30);

  async function save(maxDb: number | null) {
    if (!instance) return;
    saving = true;
    error = "";
    try {
      await api.setRestartCap(instance.id, maxDb);
      draft = null;
      await onchange();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<h4>After HQPlayer restarts{instance ? ` · ${instance.name}` : ""}</h4>
<p class="help">
  HQPlayer comes back from a restart at its saved volume, which can be louder than you left it. hqpweb can turn it down to a cap
  you choose, about a second after HQPlayer answers again (measured). It never raises the volume, and a network blip that leaves
  the volume alone is left alone.
</p>
{#if !instance}
  <p class="help">Choose an HQPlayer first.</p>
{:else if instance.source !== "configured"}
  <p class="help">Save this HQPlayer under the HQPlayer tab first; the cap is kept with it.</p>
{:else}
  <label class="row">
    <span>Lower the volume after a restart</span>
    <input
      type="checkbox"
      role="switch"
      checked={on}
      disabled={saving}
      onchange={(e) => save(e.currentTarget.checked ? value : null)}
    />
  </label>
  {#if on}
    <label class="row">
      <span>To at most</span>
      <span class="cap">
        <input
          type="number"
          step="0.5"
          min="-120"
          max="0"
          {value}
          disabled={saving}
          aria-label="Volume cap after a restart, dB"
          oninput={(e) => (draft = Number(e.currentTarget.value))}
          onchange={(e) => save(Number(e.currentTarget.value))}
        /> dB
      </span>
    </label>
    <p class="help">
      In HQPlayer's own dB, as on hqpweb's volume control (Roon may show the same volume as a percentage). It only works while
      hqpweb is running, which checks HQPlayer once a second while this is on. If something starts playback the instant HQPlayer
      is back, that first second can still be at its saved volume.
    </p>
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
{/if}

<style>
  /* As Settings' own headings and rows (Settings.svelte). */
  h4 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text);
    font-weight: 700;
    margin: 18px 0 8px;
  }
  .help {
    margin: 4px 0 8px;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
  }
  .row > input[type="checkbox"] {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .cap input {
    width: 6rem;
    font: inherit;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    text-align: right;
  }
  .err {
    color: var(--danger);
    font-size: 0.85rem;
  }
</style>
