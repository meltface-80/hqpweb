<script lang="ts">
  // What the guide is, and isn't. The first time, in full with "Got it"; after that one
  // line, which reopens the full text. Remembered on this device (prefs).
  import { prefs, savePrefs } from "./prefs.svelte.ts";

  let open = $state(false);
  const full = $derived(!prefs.guideIntroSeen || open);

  function gotIt() {
    prefs.guideIntroSeen = true;
    savePrefs();
    open = false;
  }
</script>

<div class="intro" class:full>
  {#if full}
    <p>
      No set of rules can capture everything that decides which modulator or dither suits your system. This guide gets you started
      and explains the main choices, with the source of each. After that, your ears are the best guide, with HQPlayer's manual and
      Signalyst's posts alongside. Happy listening.
    </p>
    <button class="link" onclick={gotIt}>{prefs.guideIntroSeen ? "Close" : "Got it"}</button>
  {:else}
    <p>
      A place to start, not the last word. Your ears decide.
      <button class="link" onclick={() => (open = true)}>About this guide</button>
    </p>
  {/if}
</div>

<style>
  .intro {
    margin: 0 16px 10px;
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .intro.full {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
  }
  p {
    margin: 0;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    justify-self: start;
  }
</style>
