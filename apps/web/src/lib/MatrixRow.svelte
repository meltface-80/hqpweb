<script lang="ts">
  // The signal card's Matrix profile row (owner's design, 2026-10-11): always shown, as a matrix
  // profile is part of the signal chain. Its help says where profiles are set up, for this HQPlayer;
  // once collapsed, it stays a few words on this device. Choices and wording: matrix-row.ts.
  import Picker from "./Picker.svelte";
  import { appName, type Capabilities, type Change, type Snapshot } from "./api.ts";
  import { matrixChoices, whereShort, whereToSetUp } from "./matrix-row.ts";
  import { prefs, savePrefs } from "./prefs.svelte.ts";

  let {
    caps,
    snap,
    busy,
    product,
    apply,
  }: {
    caps: Capabilities;
    snap: Snapshot;
    busy: boolean;
    /** HQPlayer's product name (GetInfo), to say where its profiles are set up. */
    product?: string;
    apply: (change: Change) => Promise<unknown>;
  } = $props();

  const row = $derived(matrixChoices(caps.matrixProfiles, snap.state.matrixProfile));
  const where = $derived(whereToSetUp(product));
  /** Open in full this time, after the "More" in the short form. */
  let more = $state(false);
  const shorten = () => {
    prefs.matrixHelpShort = true;
    savePrefs();
    more = false;
  };
</script>

{#snippet help()}
  {#if prefs.matrixHelpShort && !more}
    <p>{whereShort(product)} <button class="link" onclick={() => (more = true)}>More</button></p>
  {:else}
    <p>
      Matrix profiles are set up {where}{caps.matrixProfiles.length
        ? `; ${appName} switches between them. A switch while playing is seamless but for a brief pause. Names under about 25 characters fit on one line.`
        : `. None are set up on this HQPlayer yet; once they are, ${appName} can switch between them here.`}
    </p>
    <p>
      What's been learned here (what kept up, what fell behind) is kept in two sets: with HQPlayer's DAC correction running, and
      without. Other matrix processing isn't told apart. If you need that,
      <a href="https://github.com/statelycurmudgeon/hqpweb/issues" target="_blank" rel="noopener noreferrer">ask</a>.
    </p>
    <button class="link" onclick={shorten}>Show less</button>
  {/if}
{/snippet}

<Picker
  label="Matrix profile"
  mono
  wrap
  items={row.choices}
  current={row.current}
  disabled={busy}
  intro={help}
  onpick={(i) => apply({ matrixProfile: row.choices.find((c) => c.index === i.index)?.value ?? "" })}
/>

<style>
  p {
    margin: 0 0 6px;
  }
  a {
    color: var(--accent-text);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    cursor: pointer;
  }
</style>
