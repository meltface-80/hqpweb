<script lang="ts">
  // Presets for the selected instance, as one compact row: it names the active
  // preset and opens a sheet where one tap applies (undo stays available), with a
  // badge saying what applying means here (already active / quick / major) and
  // warnings for settings this instance can't take. Save and edit live in the sheet.
  import { api, fieldLabel, formatRate, type ApplyResult, type PresetView } from "./api.ts";

  let {
    instanceId,
    stateKey,
    busy,
    run,
  }: {
    instanceId: string;
    /** Changes whenever the instance's settings change, to refresh previews. */
    stateKey: string;
    busy: boolean;
    run: (label: string, fn: () => Promise<ApplyResult>) => Promise<void>;
  } = $props();

  let presets = $state<PresetView[] | null>(null);
  let error = $state("");
  let saving = $state(false);
  let newName = $state("");
  let includeVolume = $state(false);
  let managing = $state(false);
  let dialog: HTMLDialogElement;
  const active = $derived(presets?.filter((p) => p.preview.kind === "active").map((p) => p.name) ?? []);

  let loadSeq = 0;
  async function load() {
    // Only the latest request may update the list (instance switches race otherwise).
    const seq = ++loadSeq;
    const id = instanceId;
    try {
      const list = await api.presets(id);
      if (seq !== loadSeq) return;
      presets = list;
      error = "";
    } catch (e) {
      if (seq === loadSeq) error = (e as Error).message;
    }
  }
  $effect(() => {
    void stateKey;
    void instanceId;
    load();
  });

  function summary(p: PresetView): string {
    const s = p.settings;
    const parts = [
      s.mode,
      s.rate !== undefined ? formatRate(s.rate, s.mode ?? "") : undefined,
      s.filter1x && `1x ${s.filter1x}`,
      s.filterNx && `Nx ${s.filterNx}`,
      s.shaper,
      s.volume !== undefined ? `${s.volume} dB` : undefined,
    ].filter(Boolean);
    return parts.join(" · ");
  }

  async function apply(p: PresetView) {
    if (p.preview.kind === "active") return;
    if (
      p.preview.predicted &&
      !confirm(`${p.name}: ${p.preview.predicted.text}.\n\nApply anyway? It will be rolled back if playback stops.`)
    )
      return;
    if (
      p.preview.kind === "major" &&
      !p.preview.predicted &&
      !confirm(
        `Apply "${p.name}"?\n\nThis changes mode or output rate: playback may pause for a few seconds, and it's rolled back if it doesn't recover.`,
      )
    )
      return;
    dialog.close();
    await run(`Applying ${p.name}`, () => api.applyPreset(instanceId, p.id));
    await load();
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    try {
      await api.savePreset({ name: newName, fromInstance: instanceId, includeVolume });
      newName = "";
      includeVolume = false;
      await load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function rename(p: PresetView) {
    const name = prompt("Rename preset", p.name);
    if (!name || name === p.name) return;
    try {
      await api.renamePreset(p.id, name);
      await load();
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function updateFromCurrent(p: PresetView) {
    const vol = p.settings.volume !== undefined ? " (including volume, as before)" : "";
    if (!confirm(`Replace "${p.name}" with this instance's current settings${vol}?`)) return;
    try {
      await api.updatePresetFromCurrent(p.id, instanceId);
    } catch (err) {
      error = (err as Error).message;
    }
    await load();
  }

  async function remove(p: PresetView) {
    if (!confirm(`Delete preset "${p.name}"? Presets are shared by all instances.`)) return;
    try {
      await api.deletePreset(p.id);
    } catch (err) {
      error = (err as Error).message;
    }
    await load();
  }
</script>

<button class="trigger" onclick={() => dialog.showModal()} disabled={presets === null && !error}>
  <span class="label">Presets</span>
  <span class="value"
    >{presets === null
      ? error
        ? "unavailable"
        : "…"
      : active.length
        ? `✓ ${active.join(", ")}`
        : presets.length
          ? `${presets.length} saved`
          : "none yet"}</span
  >
  <span class="chev" aria-hidden="true">›</span>
</button>

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="sheet">
    <header>
      <h3>Presets</h3>
      <button class="close" onclick={() => dialog.close()} aria-label="Close">✕</button>
    </header>
    <div class="body">
      <section class="card list">
        {#if presets === null}
          <p class="empty">{error || "Loading…"}</p>
        {:else}
          {#each presets as p (p.id)}
            <div class="row">
              <button class="main" onclick={() => apply(p)} disabled={busy || p.preview.kind === "active"}>
                <span class="name">
                  {p.name}
                  <span class="badge {p.preview.kind}">{p.preview.kind === "active" ? "✓ active" : p.preview.kind}</span>
                </span>
                <small class="sum">{summary(p)}</small>
                {#if p.preview.predicted}
                  <small class="warn">⚠ won't play here: {p.preview.predicted.text}</small>
                {/if}
                {#if p.preview.missing.length}
                  <small class="warn"
                    >⚠ {p.preview.missing
                      .map((m) => `${fieldLabel(m.field, p.settings.mode?.startsWith("SDM"))} ${m.reason}`)
                      .join("; ")} (skipped)</small
                  >
                {:else if p.preview.unchecked}
                  <small class="sum">Switches mode; names are checked when applied</small>
                {/if}
              </button>
              {#if managing}
                <span class="manage">
                  <button class="small" onclick={() => rename(p)}>Rename</button>
                  <button class="small" onclick={() => updateFromCurrent(p)} disabled={p.preview.kind === "active"}>Update</button
                  >
                  <button class="small danger" onclick={() => remove(p)}>Delete</button>
                </span>
              {/if}
            </div>
          {:else}
            <p class="empty">No presets yet. Save the current settings below.</p>
          {/each}
        {/if}
      </section>

      <form class="save" onsubmit={save}>
        <input bind:value={newName} placeholder="Save current as…" maxlength="64" required aria-label="Preset name" />
        <label class="vol"><input type="checkbox" bind:checked={includeVolume} /> include volume</label>
        <button class="small" type="submit" disabled={saving || !newName.trim()}>Save</button>
        {#if presets?.length}
          <button class="small link" type="button" onclick={() => (managing = !managing)}>{managing ? "Done" : "Edit"}</button>
        {/if}
      </form>
      {#if error && presets !== null}<p class="err">{error}</p>{/if}
    </div>
  </div>
</dialog>

<style>
  .trigger {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .trigger .label {
    color: var(--text-dim);
  }
  .trigger .value {
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .chev {
    color: var(--text-dim);
    font-size: 1.3rem;
    line-height: 1;
  }
  dialog {
    padding: 0;
    border: 0;
    background: transparent;
    width: min(100%, 34rem);
    max-width: 100%;
    max-height: 100%;
    margin: auto auto 0;
    color: var(--text);
  }
  @media (min-width: 40rem) {
    dialog {
      margin: auto;
    }
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  .sheet {
    background: var(--bg-elev);
    border-radius: 16px 16px 0 0;
    display: flex;
    flex-direction: column;
    max-height: 85vh;
    padding-bottom: env(safe-area-inset-bottom);
  }
  @media (min-width: 40rem) {
    .sheet {
      border-radius: 16px;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 6px;
  }
  h3 {
    margin: 0;
    font-size: 1rem;
  }
  .close {
    background: none;
    border: 0;
    color: var(--text-dim);
    font-size: 1rem;
    padding: 6px;
    cursor: pointer;
  }
  .body {
    overflow-y: auto;
    padding: 0 16px 16px;
  }
  .card {
    background: var(--bg);
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .row {
    display: flex;
    align-items: center;
  }
  .row:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    min-height: 44px;
  }
  .main:disabled {
    cursor: default;
  }
  .name {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--bg-elev-2);
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge.active {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
    color: var(--ok);
    text-transform: none;
    letter-spacing: 0;
  }
  .badge.major {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
  }
  .sum {
    color: var(--text-dim);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .warn {
    color: var(--warn);
    font-size: 0.8rem;
  }
  .empty {
    color: var(--text-dim);
    padding: 12px 16px;
    margin: 0;
  }
  .manage {
    display: flex;
    gap: 6px;
    padding-right: 12px;
  }
  .save {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .save input:not([type]) {
    flex: 1 1 10rem;
    min-width: 0;
    padding: 9px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text);
    font: inherit;
  }
  .vol {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .small {
    font: inherit;
    font-size: 0.85rem;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--accent-text);
    cursor: pointer;
    min-height: 36px;
  }
  .small:disabled {
    opacity: 0.5;
  }
  .small.danger {
    color: var(--danger);
  }
  .small.link {
    border-color: transparent;
    background: none;
  }
  .err {
    color: var(--danger);
    font-size: 0.85rem;
  }
</style>
