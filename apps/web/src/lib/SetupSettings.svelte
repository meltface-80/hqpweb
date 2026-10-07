<script lang="ts">
  // Settings → Your setup: the selected instance's answers about its DAC, amplifier,
  // volume and connection, which the modulator and dither advice reads. Saved per
  // instance on the server (api.saveSetup); the questions are setup-questions.ts.
  import { api, type Inst, type Setup } from "./api.ts";
  import { monthLabel } from "./dac-table.ts";
  import FindYourDac from "./FindYourDac.svelte";
  import DacSettings from "./DacSettings.svelte";
  import { dacName } from "./dac-scope.ts";
  import { savedMessage, SETUP_QUESTION_LIST, type SetupKey } from "./setup-questions.ts";

  let { instance, onchange }: { instance: Inst | null; onchange: () => Promise<void> } = $props();

  // Shown at once on a click; put back if saving fails. Follows the instance otherwise.
  let answers = $derived<Setup>({ ...instance?.setup });
  let saving = $state(false);
  /** The last save's outcome, shown under its question, for the instance it was for. */
  let msg = $state<{ kind: "ok" | "error"; text: string; key: SetupKey; id: string } | null>(null);

  async function choose(key: SetupKey, value: string | null) {
    if (!instance) return;
    const id = instance.id;
    const before = answers;
    answers = { ...answers, [key]: value ?? undefined };
    saving = true;
    msg = null;
    try {
      const r = await api.saveSetup(id, { [key]: value });
      msg = { kind: "ok", text: savedMessage(r.savedNow), key, id };
      await onchange();
    } catch (err) {
      answers = before;
      msg = { kind: "error", text: (err as Error).message, key, id };
    } finally {
      saving = false;
    }
  }
</script>

<h4>Your setup{instance ? ` · ${instance.name}` : ""}{dacName(instance) ? ` · ${dacName(instance)}` : ""}</h4>
{#if !instance}
  <p class="help">Choose an instance first: these answers are kept for each one.</p>
{/if}
<p class="help">
  HQPlayer can't tell hqpweb which DAC or NAA it's feeding. If you point it at a different DAC, change or clear these.
</p>

<DacSettings {instance} {onchange} />

<fieldset class="setup" class:off={!instance} disabled={!instance || saving}>
  {#each SETUP_QUESTION_LIST as q (q.key)}
    <div class="q" role="radiogroup" aria-label={q.title}>
      <strong>{q.title}</strong>
      <p class="help">
        {q.question}
        {q.help ?? ""}
        {#if q.source?.url}
          (<a href={q.source.url} target="_blank" rel="noopener noreferrer">Jussi, {monthLabel(q.source.date)}</a>)
        {/if}
      </p>
      <label>
        <input type="radio" name="setup-{q.key}" checked={answers[q.key] === undefined} onchange={() => choose(q.key, null)} />
        <span
          >Not set{#if q.notSet}<small>{q.notSet}</small>{/if}</span
        >
      </label>
      {#each q.options as o (o.value)}
        <label>
          <input type="radio" name="setup-{q.key}" checked={answers[q.key] === o.value} onchange={() => choose(q.key, o.value)} />
          <span>{o.label}<small>{o.description}</small></span>
        </label>
      {/each}
      {#if msg && msg.key === q.key && msg.id === instance?.id}
        <p class={msg.kind === "error" ? "err" : "ok"} role="status">{msg.text}</p>
      {/if}
    </div>
    {#if q.key === "pcm"}<FindYourDac />{/if}
  {/each}
</fieldset>

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
  a {
    color: var(--accent-text);
  }
  .err,
  .ok {
    margin: 0;
    font-size: 0.85rem;
  }
  .err {
    color: var(--danger);
  }
  .ok {
    color: var(--ok);
  }
  .setup {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .setup.off {
    opacity: 0.6;
  }
  .q {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .q > strong {
    font-size: 0.92rem;
  }
  .q .help {
    margin: 0;
  }
  label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-size: 0.9rem;
    cursor: pointer;
    min-height: 32px;
  }
  label input {
    margin-top: 3px;
    width: 18px;
    height: 18px;
    flex: none;
    accent-color: var(--accent);
  }
  label span {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  label small {
    color: var(--text-dim);
    font-size: 0.78rem;
  }
</style>
