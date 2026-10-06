<script lang="ts">
  // "Find your DAC": the chip table and the model table, with a filter, to help answer the
  // DSD and PCM questions. Data: dacs.ts and dac-models.ts; logic: dac-table.ts.
  import { DAC_MODELS } from "./dac-models.ts";
  import {
    dayLabel,
    dsdLabel,
    filterModels,
    groupByMaker,
    hasNote,
    pcmLabel,
    rowNote,
    type CellLabel,
    type RowNote,
  } from "./dac-table.ts";
  import { CHECKED, CHIP_FAMILIES, CUTOVERS } from "./dacs.ts";

  const ISSUES = "https://github.com/statelycurmudgeon/hqpweb/issues/new?template=dac-table.md";

  let query = $state("");
  const groups = $derived(groupByMaker(filterModels(DAC_MODELS, query)));
</script>

{#snippet cell(c: CellLabel)}
  <span class="ans {c.tone}">{c.label}</span>
{/snippet}

{#snippet dated(d: { label: string; title: string })}
  <span class="dated" title={d.title}>{d.label}</span>
{/snippet}

<!-- Spaces are explicit: Svelte trims them at block edges. -->
{#snippet note(n: RowNote)}
  {n.lead}{#each n.advice as a, i (i)}{` ${a.text} `}(<a href={a.url} target="_blank" rel="noopener noreferrer">{a.cite}</a
    >{#if a.dated}, {@render dated(a.dated)}{/if}){/each}{#if n.tail}{` ${n.tail}`}{/if}
{/snippet}

<details class="find">
  <summary>Find your DAC: chips and common models</summary>
  <p class="help">Look for the chip on the spec sheet first; some models changed chips under the same name.</p>
  <table class="dt">
    <thead><tr><th>Chip or design</th><th>DSD</th><th>PCM</th></tr></thead>
    <tbody>
      {#each CHIP_FAMILIES as c (c.id)}
        {@const n = rowNote(c)}
        <tr>
          <td
            >{c.chips}{#if hasNote(n)}<small>{@render note(n)}</small>{/if}</td
          >
          <td>{@render cell(dsdLabel(c.dsd))}</td>
          <td>{@render cell(pcmLabel(c.pcm))}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <input
    class="dq"
    type="search"
    bind:value={query}
    placeholder="Filter models, e.g. Holo"
    aria-label="Filter models"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
  />
  <table class="dt">
    <thead><tr><th>Model</th><th>DSD</th><th>PCM</th></tr></thead>
    <tbody>
      {#each groups as g (g.maker)}
        <tr class="mk"><th colspan="3" scope="colgroup">{g.maker}</th></tr>
        {#each g.models as m (m.id)}
          {@const n = rowNote(m)}
          <tr class="model">
            <td>
              {m.models.join(", ")}<small
                >{m.chip}{#if hasNote(n)}. {@render note(n)}{/if}</small
              >
            </td>
            <td>{@render cell(dsdLabel(m.dsd))}</td>
            <td>{@render cell(pcmLabel(m.pcm))}</td>
          </tr>
        {/each}
      {:else}
        <tr><td colspan="3" class="none">No model matches. Try the chip, or the maker's name.</td></tr>
      {/each}
    </tbody>
  </table>

  <p class="help">
    Not listed, or wrong? <a href={ISSUES} target="_blank" rel="noopener noreferrer">Report it on GitHub</a> with a link to the
    spec sheet. Rows were checked on {dayLabel(CHECKED)} against makers' pages, reviews and Signalyst's posts. Modulator advice marked
    {@render dated(CUTOVERS[0]!)} predates HQPlayer 5.11 (Feb 2025); AHM advice marked {@render dated(CUTOVERS[1]!)}
    predates 6.1's AHM 4B (Sep 2026).
  </p>
</details>

<style>
  .find {
    margin: 4px 0 8px;
    font-size: 0.85rem;
  }
  summary {
    cursor: pointer;
    color: var(--accent-text);
    font-weight: 600;
    padding: 6px 0;
    min-height: 32px;
  }
  .help {
    color: var(--text-dim);
    font-size: 0.85rem;
    margin: 6px 0 8px;
  }
  a {
    color: var(--accent-text);
  }
  .dt {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0;
    font-size: 0.8rem;
  }
  .dt thead th {
    text-align: left;
    color: var(--text-faint);
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    padding: 4px;
    border-bottom: 1px solid var(--border);
  }
  .dt td {
    padding: 6px 4px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .dt td:not(:first-child) {
    width: 1%;
  }
  .dt td small {
    display: block;
    color: var(--text-dim);
    font-size: 0.74rem;
    margin-top: 2px;
  }
  /* The app's section-heading style (Settings h4, Picker .group). */
  .mk th {
    text-align: left;
    padding: 14px 4px 4px;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text);
    border-bottom: 1px solid var(--border);
  }
  .none {
    color: var(--text-dim);
  }
  .ans {
    white-space: nowrap;
    font-size: 0.72rem;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .ans.warn {
    background: color-mix(in srgb, var(--warn) 15%, transparent);
    color: var(--warn);
    border-color: transparent;
  }
  .ans.accent {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: transparent;
  }
  .ans.ok {
    background: color-mix(in srgb, var(--ok) 15%, transparent);
    color: var(--ok);
    border-color: transparent;
  }
  .ans.dim {
    color: var(--text-dim);
  }
  .dated {
    color: var(--warn);
    white-space: nowrap;
    border-bottom: 1px dotted currentColor;
    cursor: help;
  }
  .dq {
    width: 100%;
    box-sizing: border-box;
    margin: 10px 0 2px;
    padding: 9px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
</style>
