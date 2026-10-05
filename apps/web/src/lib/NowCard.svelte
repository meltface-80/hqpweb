<script lang="ts">
  // The Now card: what's playing, position, transport, warnings about playback, the
  // processing figure and volume. Changes go through `apply`; what HQPlayer reports
  // back, and messages for the footer, go to App through onstatus and onmessage.
  import { untrack } from "svelte";
  import { RECOMMENDED_MAX_VOLUME_DB } from "@app/protocol/compat";
  import { api, formatRate, PLAYBACK, type Capabilities, type Change, type RoonZone, type Snapshot, type Status } from "./api.ts";
  import { control, MISMATCH_POLLS, roonPosition, stepVolume, zoneMismatch } from "./control.ts";
  import { apodization, type wedge as wedgeOf } from "./hints.ts";
  import { prefs } from "./prefs.svelte.ts";
  import { notStartedMessage, type ResultMessage } from "./result.ts";
  import type { SpeedClass } from "./speed.ts";

  let {
    selected,
    snap,
    caps,
    roonZone,
    seekBase = $bindable(),
    volDraft = $bindable(),
    busy,
    apply,
    wedge,
    inUseFilter,
    inUseApodizing,
    speedClass,
    speedText,
    speedTitle,
    onfixwedge,
    onsuggestapodizing,
    onstatus,
    onmessage,
  }: {
    selected: string | null;
    snap: Snapshot;
    caps: Capabilities | null;
    roonZone: RoonZone | null;
    seekBase: { seek: number; at: number } | null;
    volDraft: number | null;
    busy: boolean;
    apply: (change: Change) => Promise<void>;
    wedge: ReturnType<typeof wedgeOf>;
    inUseFilter: string;
    inUseApodizing: boolean | "partial" | undefined;
    speedClass: SpeedClass;
    speedText: string;
    speedTitle: string;
    onfixwedge: () => void;
    onsuggestapodizing: () => void;
    onstatus: (status: Status) => void;
    onmessage: (m: ResultMessage) => void;
  } = $props();

  const APOD_TITLE =
    "HQPlayer's apodization counter: problems in the recording that an apodizing filter corrects. HQPlayer's manual suggests one once it passes 10 in a track.";
  // Apod counts problems detected in the recording (manual §2.6), per track: seen past
  // 150 on one track, 5 on the next, and still climbing after switching to an
  // apodizing filter, which corrects them without stopping the count (5.17.2, Linux).
  // Clips: inferred from the name; never seen above 0.
  const CLIPS_TITLE = "HQPlayer's clip counter (likely samples it had to clip). Lowering the volume gives it headroom.";
  const apod = $derived(snap.status.apod ?? 0);
  const clips = $derived(snap.status.clips ?? 0);
  const apodState = $derived(apodization(apod, inUseApodizing));

  // ---- volume jumped without hqpweb (e.g. HQPlayer restarted at −3 dB) ---------
  let hiddenJump = $state("");
  const jump = $derived(snap.volumeJump && snap.volumeJump.at !== hiddenJump ? snap.volumeJump : null);
  async function dismissJump() {
    if (!jump || !selected) return;
    hiddenJump = jump.at;
    await api.dismissVolumeJump(selected).catch(() => undefined);
  }

  let tbusy = $state(false);
  // Who controls playback, HQPlayer or Roon: the measured rules are in lib/control.ts.
  const ctl = $derived(control(snap, roonZone));
  const viaRoon = $derived(ctl.viaRoon);
  const playing = $derived(ctl.playing);
  let clock = $state(Date.now());
  let seekDraft = $state<number | null>(null);
  $effect(() => {
    if (!playing) return;
    const t = setInterval(() => (clock = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const position = $derived(roonPosition(seekBase, viaRoon?.nowPlaying?.length, playing, clock));
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  let hqSeekDraft = $state<number | null>(null);
  async function hqSeekTo(seconds: number) {
    if (!selected) return;
    try {
      const r = await api.seek(selected, seconds);
      onstatus(r.status);
    } catch (e) {
      onmessage({ kind: "error", text: (e as Error).message });
    } finally {
      hqSeekDraft = null;
    }
  }
  async function seekTo(seconds: number) {
    if (!selected) return;
    try {
      await api.roonSeek(selected, seconds);
      seekBase = { seek: seconds, at: Date.now() };
    } catch (e) {
      onmessage({ kind: "error", text: (e as Error).message });
    } finally {
      seekDraft = null;
    }
  }
  // Roon playing while this HQPlayer sits stopped usually means the wrong zone is mapped.
  let mismatchTicks = $state(0);
  $effect(() => {
    // Counts HQPlayer status polls (~1.5 s), not Roon's once-a-second seek updates.
    const zone = untrack(() => roonZone);
    const m = zoneMismatch(snap, zone);
    mismatchTicks = m ? untrack(() => mismatchTicks) + 1 : 0;
  });
  const ROON_NOTE =
    "Playing from Roon: Stop stops HQPlayer; play, skip and resume are in Roon (or connect Roon in Settings → Roon)";
  const allowed = (a: "play" | "pause" | "previous" | "next") => ctl.allowed(a);
  async function transport(action: "play" | "pause" | "stop" | "previous" | "next") {
    if (!selected) return;
    tbusy = true;
    try {
      // The event stream brings the new state; the reply can predate the change.
      if (ctl.route(action) === "roon") await api.roonTransport(selected, action as Exclude<typeof action, "stop">);
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

  const vol = $derived(volDraft ?? snap.state.volume ?? 0);
  const step = (d: number) => {
    if (!caps) return;
    const v = stepVolume(snap.state.volume, d, caps.volumeRange);
    if (v !== null) void apply({ volume: v }); // apply reports its own errors in the footer
  };
</script>

<section class="card now">
  {#if viaRoon?.nowPlaying}
    {@const np = viaRoon.nowPlaying}
    <div class="track">
      {#if np.imageKey}<img src={`/api/roon/art/${np.imageKey}?size=192`} alt="" width="64" height="64" />{/if}
      <div>
        <b>{np.track}</b>
        <small>{[np.artist, np.album].filter(Boolean).join(" · ")}</small>
      </div>
    </div>
    {#if np.length && position != null}
      <div class="seek">
        <span>{mmss(seekDraft ?? position)}</span>
        <input
          type="range"
          min="0"
          max={np.length}
          step="1"
          value={seekDraft ?? position}
          disabled={!viaRoon.allowed.seek}
          oninput={(e) => (seekDraft = Number(e.currentTarget.value))}
          onchange={(e) => seekTo(Number(e.currentTarget.value))}
          aria-label="Position"
        />
        <span>{mmss(np.length)}</span>
      </div>
    {/if}
  {/if}
  {#if !viaRoon && snap.status.state !== 0 && snap.status.position > 0}
    <!-- HQPlayer's own position. Length is 0 for streams such as Roon's, so no slider then;
         with a length, dragging seeks (HQPlayer refuses on unseekable sources, and says so). -->
    <div class="seek">
      <span>{mmss(hqSeekDraft ?? snap.status.position)}</span>
      {#if snap.status.length > 0}
        <input
          type="range"
          min="0"
          max={snap.status.length}
          step="1"
          value={hqSeekDraft ?? Math.min(snap.status.position, snap.status.length)}
          disabled={busy}
          oninput={(e) => (hqSeekDraft = Number(e.currentTarget.value))}
          onchange={(e) => hqSeekTo(Number(e.currentTarget.value))}
          aria-label="Position"
        />
        <span>{mmss(snap.status.length)}</span>
      {/if}
    </div>
  {/if}
  {#if jump}
    <p class="wedge">
      Volume jumped from {jump.from} to {jump.to} dB{jump.restarted ? " (HQPlayer probably restarted)" : ""}.
      <button class="link" onclick={() => apply({ volume: jump!.from })} disabled={busy}>Back to {jump.from} dB</button>
      <button class="link quiet" onclick={dismissJump}>Dismiss</button>
    </p>
  {/if}
  {#if apodState === "suggest" && inUseFilter}
    <p class="wedge">
      This recording keeps needing apodization ({apod} so far). {inUseFilter} isn't an apodizing filter{inUseApodizing ===
      "partial"
        ? " (only partly)"
        : ""}.
      <button class="link" onclick={onsuggestapodizing}>Choose an apodizing filter…</button>
    </p>
  {/if}
  {#if wedge}
    <p class="wedge">
      The next track won't start: {wedge.text}.
      <button class="link" onclick={onfixwedge} disabled={busy}>Fix…</button>
    </p>
  {/if}
  {#if mismatchTicks >= MISMATCH_POLLS && roonZone}
    <p class="mismatch">
      Roon is playing in “{roonZone.name}”, but this HQPlayer is stopped. If that zone isn't fed by this HQPlayer, pick another in
      Settings → Roon.
    </p>
  {/if}
  <div class="headline">
    <span class="big">{formatRate(snap.status.activeRate, snap.status.activeMode)}</span>
    <span class="sub">
      <span class="mode">{snap.status.activeMode}</span>
      <span class="state s{snap.status.state}">{PLAYBACK[snap.status.state]}</span>
    </span>
  </div>
  <div class="transport">
    {#if ctl.stopOnly}
      <!-- Roon is the source and the Roon link isn't set up: HQPlayer-side play and
           next don't reach Roon (measured), so offer only Stop. -->
      <button
        class="tbtn stop"
        onclick={() => transport("stop")}
        disabled={tbusy || snap.status.state === 0}
        title={ROON_NOTE}
        aria-label="Stop"
      >
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 6h12v12H6z" /></svg>
        <span>Stop</span>
      </button>
    {:else}
      <button
        class="tbtn"
        onclick={() => transport("previous")}
        disabled={tbusy || !allowed("previous")}
        title="Previous"
        aria-label="Previous track"
      >
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
      </button>
      <button
        class="tbtn main"
        onclick={() => transport(playing ? "pause" : "play")}
        disabled={tbusy || !allowed(playing ? "pause" : "play")}
        title={playing ? "Pause" : "Play"}
        aria-label={playing ? "Pause" : "Play"}
      >
        {#if playing}
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
        {/if}
      </button>
      <button
        class="tbtn"
        onclick={() => transport("next")}
        disabled={tbusy || !allowed("next")}
        title="Next"
        aria-label="Next track"
      >
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M16 5h2v14h-2zM4 5l11 7-11 7z" /></svg>
      </button>
    {/if}
  </div>
  <dl class="side">
    <dt>Source</dt>
    <dd>
      {snap.status.source ? `${formatRate(snap.status.source.sampleRate, "PCM")} / ${snap.status.source.bits}-bit` : "—"}
    </dd>
    <dt title={speedTitle}>Processing</dt>
    <dd class="speed {speedClass}" title={speedTitle}>{speedText}</dd>
    {#if apod > 0}
      <dt title={APOD_TITLE}>Apod</dt>
      <dd class="speed {apodState === 'suggest' ? 'bad' : 'warn'}" title={APOD_TITLE}>
        {apod}{apodState === "handled" ? " · your filter handles this" : ""}
      </dd>
    {/if}
    {#if clips > 0}
      <dt title={CLIPS_TITLE}>Clips</dt>
      <dd class="speed warn" title={CLIPS_TITLE}>{clips} · lower the volume</dd>
    {/if}
  </dl>
  {#if caps}
    <!-- Volume belongs with playback: compact, on the Now card. -->
    <div class="vol">
      <button class="round" onclick={() => step(-prefs.volumeStep)} disabled={busy} aria-label="Down {prefs.volumeStep} dB"
        >−</button
      >
      <input
        type="range"
        min={caps.volumeRange.min}
        max={caps.volumeRange.max}
        step="0.5"
        value={vol}
        disabled={busy || !caps.volumeRange.enabled}
        oninput={(e) => (volDraft = Number(e.currentTarget.value))}
        onchange={(e) => apply({ volume: Number(e.currentTarget.value) })}
        aria-label="Volume"
        title="{caps.volumeRange.min} to {caps.volumeRange.max} dB"
      />
      <button class="round" onclick={() => step(prefs.volumeStep)} disabled={busy} aria-label="Up {prefs.volumeStep} dB">+</button
      >
      <output>{vol.toFixed(1)}<small> dB</small></output>
    </div>
    {#if vol > RECOMMENDED_MAX_VOLUME_DB}
      <p class="vol-note">Above −3 dB: HQPlayer recommends −3 dB or lower when resampling, to avoid inter-sample overs.</p>
    {/if}
  {/if}
</section>

<style>
  .vol {
    flex: 1 1 100%;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vol input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .vol output {
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    min-width: 4.8rem;
    text-align: right;
  }
  .vol output small {
    color: var(--text-dim);
    font-weight: 400;
  }
  .vol .round {
    width: 34px;
    height: 34px;
    font-size: 1.1rem;
  }
  .vol-note {
    flex: 1 1 100%;
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .now {
    padding: 16px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
  }
  .headline {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    margin: 0;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .side {
    grid-template-columns: auto auto;
    text-align: right;
    font-size: 0.9rem;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .seek {
    flex: 1 1 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.8rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .seek input {
    flex: 1;
    accent-color: var(--accent);
  }
  .wedge {
    flex: 1 1 100%;
    margin: 0;
    font-size: 0.85rem;
    color: var(--warn);
  }
  .mismatch {
    flex: 1 1 100%;
    margin: 0;
    font-size: 0.85rem;
    color: var(--warn);
  }
  .track {
    flex: 1 1 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .track img {
    width: 64px;
    height: 64px;
    border-radius: 8px;
    object-fit: cover;
    flex: none;
    background: var(--bg-elev-2);
  }
  .track div {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .track b,
  .track small {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track small {
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .tbtn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: var(--bg-elev-2);
    color: var(--text);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .tbtn.stop {
    width: auto;
    padding: 0 16px;
    border-radius: 999px;
    gap: 6px;
    display: flex;
    font: inherit;
    font-weight: 600;
  }
  .tbtn.main {
    width: 52px;
    height: 52px;
    background: var(--accent);
    color: var(--on-accent);
  }
  .tbtn:disabled {
    opacity: 0.5;
  }
  .side dd {
    font-variant-numeric: tabular-nums;
  }
  .speed.ok {
    color: var(--ok);
  }
  .speed.warn {
    color: var(--warn);
  }
  .speed.bad {
    color: var(--danger);
    font-weight: 600;
  }
  .state {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-elev-2);
    color: var(--text-dim);
    align-self: center;
  }
  .state.s2 {
    background: color-mix(in srgb, var(--ok) 16%, transparent);
    color: var(--ok);
  }
  .state.s3 {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    color: var(--warn);
  }
  .big {
    font-size: 1.9rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .mode {
    color: var(--text-dim);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 0;
  }
  dt {
    color: var(--text-dim);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .round {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg);
    color: inherit;
    font-size: 1.5rem;
    cursor: pointer;
  }
  .round:disabled {
    opacity: 0.5;
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--accent-text);
  }
  /* Shared with App.svelte (styles are scoped per component). */
  .card {
    background: var(--bg-elev);
    border-radius: 14px;
  }
  .link {
    background: none;
    border: 0;
    padding: 0 0 0 4px;
    font: inherit;
    font-weight: 600;
    color: var(--accent-text);
    cursor: pointer;
  }
  .link.quiet {
    color: var(--text-dim);
    font-weight: 400;
  }
</style>
