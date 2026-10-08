<script lang="ts">
  // The v2 mini bar (docs/design-v2-layout.md): when the now card has scrolled away on a
  // narrow screen, the title, health, play/pause and volume stay at hand. Tapping the
  // title goes back to the now card. Rules in mini.ts; transport routes as the now card's.
  import { api, type Capabilities, type Change, type RoonZone, type Snapshot, type Status } from "./api.ts";
  import { control, stepVolume } from "./control.ts";
  import { miniPlay, miniTitle } from "./mini.ts";
  import { prefs } from "./prefs.svelte.ts";
  import { notStartedMessage, type ResultMessage } from "./result.ts";

  let {
    snap,
    caps,
    zone,
    selected,
    busy,
    apply,
    health,
    healthClass,
    onback,
    onstatus,
    onmessage,
  }: {
    snap: Snapshot;
    caps: Capabilities;
    zone: RoonZone | null;
    selected: string;
    busy: boolean;
    apply: (change: Change) => Promise<unknown>;
    health: string;
    healthClass: string;
    onback: () => void;
    onstatus: (status: Status) => void;
    onmessage: (m: ResultMessage) => void;
  } = $props();

  const play = $derived(miniPlay(snap, zone));
  let tbusy = $state(false);
  async function press(action: "play" | "pause") {
    tbusy = true;
    try {
      if (control(snap, zone).route(action) === "roon") await api.roonTransport(selected, action);
      else {
        const r = await api.transport(selected, action);
        onstatus(r.status);
        const m = notStartedMessage(r.notStarted);
        if (m) onmessage(m);
      }
    } catch (e) {
      onmessage({ kind: "error", text: (e as Error).message });
    } finally {
      tbusy = false;
    }
  }
  function step(d: number) {
    const v = stepVolume(snap.state.volume, d, caps.volumeRange);
    if (v !== null) void apply({ volume: v });
  }
</script>

<div class="mini" role="region" aria-label="Now playing, compact">
  <button class="title" onclick={onback} aria-label="Back to now playing">
    <span class="name">{miniTitle(snap, zone)}</span>
    <span class="health {healthClass}">● {health}</span>
  </button>
  {#if play}
    <button class="play" aria-label={play.label} disabled={tbusy} onclick={() => press(play.action)}>
      {#if play.action === "pause"}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
          ><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg
        >
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
      {/if}
    </button>
  {/if}
  <button class="vol" aria-label="Down {prefs.volumeStep} dB" disabled={busy} onclick={() => step(-prefs.volumeStep)}>−</button>
  <span class="db">{snap.state.volume}</span>
  <button class="vol" aria-label="Up {prefs.volumeStep} dB" disabled={busy} onclick={() => step(prefs.volumeStep)}>+</button>
</div>

<style>
  .mini {
    position: fixed;
    left: 8px;
    right: 8px;
    /* Above the footer (result and Undo) while it's shown: Footer.svelte sets --footer-h. */
    bottom: calc(var(--footer-h, 0px) + max(12px, env(safe-area-inset-bottom)));
    transition: bottom 0.4s;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 16px;
    background: var(--bg-elev-2);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
  }
  .title {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .name {
    font-weight: 600;
    font-size: 0.9rem;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .health {
    font-size: 0.75rem;
    color: var(--ok);
  }
  .health.warn {
    color: var(--warn);
  }
  .health.bad {
    color: var(--danger);
  }
  .play {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    border: 0;
    background: var(--text);
    color: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .vol {
    width: 40px;
    height: 40px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 1.1rem;
    cursor: pointer;
  }
  .db {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    min-width: 2.5em;
    text-align: center;
  }
  @media (prefers-reduced-motion: no-preference) {
    .mini {
      animation: rise 0.18s ease-out;
    }
    @keyframes rise {
      from {
        transform: translateY(16px);
        opacity: 0;
      }
    }
  }
</style>
