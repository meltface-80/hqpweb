<script lang="ts">
  // The result of the last change, and what can be done about it: Restart playback, Undo.
  import type { ResultMessage } from "./result.ts";

  let {
    show,
    message,
    busy,
    undoAvailable,
    onrestart,
    onundo,
  }: {
    show: boolean;
    message: ResultMessage | null;
    busy: boolean;
    undoAvailable: boolean;
    onrestart: () => void;
    onundo: () => void;
  } = $props();

  // Its height while shown, so the v2 mini bar (MiniBar.svelte) can sit above it.
  let height = $state(0);
  $effect(() => {
    document.documentElement.style.setProperty("--footer-h", show ? `${height}px` : "0px");
  });
</script>

<footer class:show bind:clientHeight={height}>
  {#if message}<p class="msg {message.kind}">{message.text}</p>{/if}
  {#if message?.restart}<button class="undo" onclick={onrestart} disabled={busy}>Restart playback</button>{/if}
  {#if undoAvailable}<button class="undo" onclick={onundo} disabled={busy}>Undo last change</button>{/if}
</footer>

<style>
  footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
    /* Opaque: the page underneath showed through and read as faded-out content. */
    background: var(--bg);
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    opacity: 0;
    transform: translateY(100%);
    pointer-events: none;
    transition:
      opacity 0.4s,
      transform 0.4s;
  }
  footer.show {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
  .msg {
    margin: 0;
    max-width: 34rem;
    text-align: center;
    font-size: 0.9rem;
  }
  .msg.ok {
    color: var(--ok);
  }
  .msg.warn {
    color: var(--warn);
  }
  .msg.error {
    color: var(--danger);
  }
  .msg.info {
    color: var(--text-dim);
  }
  .undo {
    font: inherit;
    font-weight: 600;
    padding: 10px 18px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--accent-text);
    cursor: pointer;
  }
</style>
