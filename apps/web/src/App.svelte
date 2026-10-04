<script lang="ts">
  // Live "Now" card, quick changes, Advanced (mode and rate), undo. Changes that
  // can disturb playback are checked by the server and rolled back if they fail.
  import { untrack } from "svelte";
  import Picker from "./lib/Picker.svelte";
  import Settings from "./lib/Settings.svelte";
  import Presets from "./lib/Presets.svelte";
  import { prefs } from "./lib/prefs.svelte.ts";
  import { RECOMMENDED_MAX_VOLUME_DB, ditherHint, filterSlot, modulatorHint, ratioHint, type Hint } from "@app/protocol/compat";
  import {
    api,
    formatRate,
    FIELD_LABEL,
    PLAYBACK,
    knownBad,
    type ApplyResult,
    type Capabilities,
    type Change,
    type Combo,
    type Inst,
    type PlaybackCheck,
    type RoonZone,
    type Snapshot,
  } from "./lib/api.ts";

  const STORE_KEY = "instance";
  const remembered = (() => {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  })();

  let instances = $state<Inst[]>([]);
  let selected = $state<string | null>(null);
  let snap = $state<Snapshot | null>(null);
  let caps = $state<Capabilities | null>(null);
  let online = $state<"connecting" | "live" | "unreachable" | "lost">("connecting");
  let offlineReason = $state("");
  let busy = $state(false);
  let undoAvailable = $state(false);
  let message = $state<{ kind: "ok" | "warn" | "error" | "info"; text: string } | null>(null);
  // The footer (result + Undo) fades 30 s after the last change; it stays while a
  // change is running or HQPlayer is falling behind (the banner points at Undo).
  let footerOpen = $state(false);
  $effect(() => {
    void message;
    void undoAvailable;
    footerOpen = !!(message || undoAvailable);
    if (!footerOpen || busy) return;
    const t = setTimeout(() => (footerOpen = false), 30_000);
    return () => clearTimeout(t);
  });
  let volDraft = $state<number | null>(null);
  let settings: Settings;
  // Local, so a re-render can't snap it shut; Settings only sets the starting state.
  let advancedOpen = $state(prefs.advancedOpen);
  // Speed vs real time: the server fits Status position over 30 s (no access to
  // the machine needed). Shown as a state, not a number: amber only after 15 s
  // below 0.97, red below 0.90. The number is in the tooltip.
  const speed = $derived(snap?.health?.speed ?? null);
  let slowSince = $state<number | null>(null);
  $effect(() => {
    const low = speed != null && speed < 0.97;
    untrack(() => {
      if (!low) slowSince = null;
      else if (slowSince === null) slowSince = Date.now();
    });
  });
  // HQPlayer 5.17.2+ reports its own processing speed (× real time): when it does,
  // show that number. Below 1× it can't keep up; under 1.5× there's little headroom.
  const processSpeed = $derived(snap?.health?.processSpeed ?? null);
  const fmtX = (v: number) => (v >= 10 ? `${Math.round(v)}×` : `${v.toFixed(1)}×`);
  const speedClass = $derived(
    processSpeed != null
      ? processSpeed < 1
        ? "bad"
        : processSpeed < 1.5
          ? "warn"
          : "ok"
      : speed == null
        ? ""
        : speed < 0.9
          ? "bad"
          : slowSince !== null && (snap ? Date.now() : 0) - slowSince >= 15_000
            ? "warn"
            : "ok",
  );
  const SPEED_LABEL: Record<string, string> = { ok: "Real-time ✓", warn: "Straining", bad: "Falling behind" };
  const speedText = $derived(processSpeed != null ? fmtX(processSpeed) : speed == null ? "—" : SPEED_LABEL[speedClass]);
  const speedTitle = $derived(
    processSpeed != null
      ? `HQPlayer is processing at ${processSpeed.toFixed(1)}× real time (3-second average): it could run that many times faster than playback needs. Below 1× it can't keep up and audio drops; close to 1× leaves little headroom.`
      : speed == null
        ? "Shown while playing, after about 30 s of a track."
        : `HQPlayer is processing at ${speed.toFixed(3)}× real time over the last 30 s. Below 1.0 it can't keep up and audio will drop. Brief dips during a change are normal.`,
  );
  let offlineSince = $state<Date | null>(null);
  const slow = $derived((snap?.health?.latencyMs ?? 0) > 1500);
  const dotTitle = $derived(
    online === "unreachable"
      ? `Not responding${offlineSince ? ` since ${offlineSince.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}: ${offlineReason}`
      : online === "live"
        ? `Responding — ${snap?.health?.latencyMs ?? "?"} ms${slow ? " (slow)" : ""}`
        : online === "lost"
          ? "Lost connection to the app's server"
          : "Connecting…",
  );

  /** Load the instance list; keep the selection if it still exists. */
  async function refreshInstances() {
    try {
      const list = await api.instances();
      instances = list;
      if (!list.some((i) => i.id === selected)) {
        selected = list.find((i) => i.id === remembered)?.id ?? list[0]?.id ?? null;
      }
    } catch (e) {
      message = { kind: "error", text: `Can't reach the app's server: ${(e as Error).message}` };
    }
  }
  $effect(() => {
    refreshInstances();
    const t = setInterval(refreshInstances, 30_000);
    return () => clearInterval(t);
  });

  // Live status over server-sent events.
  $effect(() => {
    const id = selected;
    if (!id) return;
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch {}
    snap = null;
    caps = null;
    undoAvailable = false;
    message = null;
    online = "connecting";
    roonZone = null;
    seekBase = null;
    const es = api.events(id);
    es.addEventListener("now", (e) => {
      snap = JSON.parse((e as MessageEvent).data);
      online = "live";
      offlineSince = null;
    });
    // Only sent when Roon is switched on in Settings.
    es.addEventListener("roon", (e) => {
      roonZone = JSON.parse((e as MessageEvent).data).zone;
      // The server sends the position only when it jumps; advance it locally.
      const seek = roonZone?.nowPlaying?.seek;
      seekBase = seek != null ? { seek, at: Date.now() } : null;
    });
    es.addEventListener("unreachable", (e) => {
      if (online !== "unreachable") offlineSince = new Date();
      online = "unreachable";
      offlineReason = JSON.parse((e as MessageEvent).data).error;
    });
    es.onerror = () => (online = "lost");
    return () => es.close();
  });

  // Lists depend on the mode: (re)load when the mode differs from what we hold.
  $effect(() => {
    const id = selected;
    const mode = snap?.state.mode;
    if (!id || mode === undefined || caps?.mode.index === mode) return;
    api
      .capabilities(id)
      .then((c) => (caps = c))
      .catch((e) => (message = { kind: "error", text: e.message }));
  });

  const nameAt = (list: { index: number; name: string }[] | undefined, i: number | undefined) =>
    list?.find((x) => x.index === i)?.name ?? "";

  const isSdm = $derived(caps?.mode.name.startsWith("SDM") ?? false);
  // Measured: a 44.1/48 kHz source uses the 1x filter, higher rates the Nx filter.
  const inUse = $derived.by(() => {
    if (!snap || snap.status.state === 0) return null;
    const sr = snap.status.source?.sampleRate;
    if (sr) return filterSlot(sr); // manual §4.6: 1x below 50 kHz
    return snap.state.filterInUse === snap.state.filter1x ? "1x" : "Nx";
  });

  const show = (field: keyof Change, v: string | number | boolean) =>
    field === "rate" ? formatRate(Number(v), caps?.mode.name ?? "") : field === "volume" ? `${v} dB` : String(v);

  const optionLabel = (i: Inst) =>
    `${i.reachable === false ? "⚠ " : ""}${i.name}${i.source === "discovered" ? " (discovered)" : ""}`;

  /** Has the selected filter in this slot taken? null when the slot isn't in use. */
  const takenFor = (slot: "1x" | "Nx", name: string) =>
    snap?.status.state === 2 && inUse === slot ? snap.status.activeFilter === name : null;

  /** The combination in use now, by name, for matching known failures. */
  const combo = $derived.by((): Combo | null => {
    if (!snap || !caps) return null;
    return {
      mode: caps.mode.name,
      rateHz: snap.status.activeRate,
      filterNx: nameAt(caps.filters, snap.state.filterNx),
      filter1x: nameAt(caps.filters, snap.state.filter1x),
      shaper: nameAt(caps.shapers, snap.state.shaper),
    };
  });
  /** Warning text if switching `field` to `value` gives a combination that failed here before. */
  const warnFor = (field: keyof Combo, value: string | number) => {
    if (!combo || !caps) return undefined;
    const f = knownBad(caps.knownBad, { ...combo, [field]: value });
    return f ? `failed here before at these settings (${f.reason})` : undefined;
  };
  /** Rule hints (manual) first, then learned failures. Hard → warning, soft → note. */
  const decorate = <T extends { name: string }>(i: T, rule: Hint | undefined, learned: string | undefined, note?: string) => ({
    ...i,
    warn: rule?.level === "hard" ? `won't play: ${rule.text}` : learned,
    note: [note, rule?.level === "soft" ? rule.text : undefined].filter(Boolean).join(" · ") || undefined,
  });
  const source = $derived(snap?.status.source?.sampleRate ?? 0);
  const outRate = $derived(snap?.status.activeRate ?? 0);
  /** Rate is fixed (not auto): only then can a filter choice make the ratio impossible. */
  const fixedRate = $derived((snap?.state.rate ?? 0) !== 0);
  const filterItems = (slot: "1x" | "Nx") =>
    (caps?.filters ?? []).map((f) =>
      decorate(
        f,
        source && fixedRate && filterSlot(source) === slot ? ratioHint(f.name, source, outRate, isSdm) : undefined,
        warnFor(slot === "1x" ? "filter1x" : "filterNx", f.name),
      ),
    );
  const shaperItems = $derived(
    (caps?.shapers ?? []).map((s) =>
      decorate(s, isSdm ? modulatorHint(s.name, outRate) : ditherHint(s.name, outRate), warnFor("shaper", s.name)),
    ),
  );
  const inUseFilter = $derived(
    caps && snap && source ? nameAt(caps.filters, filterSlot(source) === "1x" ? snap.state.filter1x : snap.state.filterNx) : "",
  );
  const shaperName = $derived(caps && snap ? nameAt(caps.shapers, snap.state.shaper) : "");
  const rateItems = $derived(
    (caps?.rates ?? []).map((r) => {
      const ratio = r.rate && source ? ratioHint(inUseFilter, source, r.rate, isSdm) : undefined;
      const mod = r.rate ? (isSdm ? modulatorHint(shaperName, r.rate) : ditherHint(shaperName, r.rate)) : undefined;
      const rule = ratio?.level === "hard" ? ratio : mod;
      return {
        ...decorate(
          { index: r.index, name: formatRate(r.rate, caps!.mode.name) },
          rule,
          r.rate ? warnFor("rateHz", r.rate) : undefined,
          r.note,
        ),
        rate: r.rate,
        disabled: !r.allowed,
      };
    }),
  );

  function describe(r: ApplyResult) {
    const base = describeCore(r);
    if (!r.skipped?.length) return base;
    const sk = r.skipped.map((x) => `${FIELD_LABEL[x.field]} (${x.reason})`).join("; ");
    return { kind: "warn" as const, text: `${base.text} · Skipped: ${sk}` };
  }

  function describeCore(r: ApplyResult) {
    if (r.rolledBack) {
      const back = r.rolledBack.results.map((x) => `${FIELD_LABEL[x.field]} back to ${show(x.field, x.actual)}`).join(", ");
      const rec: PlaybackCheck = r.rolledBack.playback;
      const tail =
        rec.kind === "playing"
          ? "Playback resumed."
          : rec.kind === "not-checked"
            ? ""
            : `Playback did not recover (${rec.detail}): HQPlayer may need a restart.`;
      return {
        kind: "warn" as const,
        text: r.incompatible
          ? `Rolled back: ${r.incompatible.text}. ${back}. ${tail} That's an HQPlayer rule, not a limit of this machine.`
          : `Rolled back: ${r.playback.detail}. ${back}. ${tail} Marked as not working on this instance.`,
      };
    }
    const failed = r.results.filter((x) => !x.applied);
    const notes = r.results.filter((x) => x.note).map((x) => `${FIELD_LABEL[x.field]} ${x.note}`);
    if (failed.length) {
      const text = failed
        .map(
          (x) => `${FIELD_LABEL[x.field]}: asked for ${show(x.field, x.requested)}, HQPlayer reports ${show(x.field, x.actual)}`,
        )
        .concat(notes)
        .join(" · ");
      return { kind: "warn" as const, text };
    }
    if (r.results.length === 0) return { kind: "warn" as const, text: "Nothing applied" };
    const text = r.results.map((x) => `${FIELD_LABEL[x.field]} → ${show(x.field, x.actual)}`);
    const pb =
      r.playback.kind === "playing"
        ? "playback OK"
        : r.playback.kind === "not-checked" && r.playback.detail?.startsWith("nothing")
          ? "not playing, so not checked"
          : r.playback.kind === "inconclusive"
            ? `playback not checked (${r.playback.detail})`
            : "";
    return { kind: "ok" as const, text: ["✓ " + text.join(", "), pb, ...notes].filter(Boolean).join(" · ") };
  }

  async function run(label: string, fn: () => Promise<ApplyResult>) {
    if (!selected || busy) return;
    busy = true;
    message = { kind: "info", text: `${label}…` };
    try {
      const r = await fn();
      if (snap) snap = { ...snap, state: r.state };
      undoAvailable = r.undoAvailable;
      message = describe(r);
      // A rollback teaches the server a failed combination: refresh the warnings.
      if (r.rolledBack && selected) caps = await api.capabilities(selected);
    } catch (e) {
      message = { kind: "error", text: (e as Error).message };
    } finally {
      busy = false;
      volDraft = null;
    }
  }

  // Same list as the server's RISKY (instance.ts): changes that can stop playback.
  const RISKY: (keyof Change)[] = ["mode", "rate", "filterNx", "filter1x", "shaper", "convolution", "matrixProfile"];
  const apply = (change: Change) => {
    const risky = (Object.keys(change) as (keyof Change)[]).some((k) => RISKY.includes(k));
    const label = risky && snap?.status.state === 2 ? "Applying and checking playback" : "Applying";
    return run(label, () => api.change(selected!, change));
  };
  /** Apply a switch, then show what HQPlayer actually reports (it can say OK and not change). */
  const toggle = async (el: HTMLInputElement, key: "invert" | "filter20k" | "adaptive" | "convolution") => {
    await apply({ [key]: el.checked });
    if (snap) el.checked = snap.state[key];
  };

  let tbusy = $state(false);
  // Roon's zone for this instance, when Roon is on and a zone is mapped.
  let roonZone = $state<RoonZone | null>(null);
  // Roon drives the card only while it's the source (or HQPlayer is idle); when
  // HQPlayer plays something else, its own playlist say, HQPlayer's controls apply.
  const fromRoon = $derived(snap?.status.source?.song === "Roon");
  const viaRoon = $derived(roonZone && (fromRoon || snap?.status.state === 0) ? roonZone : null);
  const playing = $derived(viaRoon ? viaRoon.state === "playing" : snap?.status.state === 2);
  let seekBase = $state<{ seek: number; at: number } | null>(null);
  let clock = $state(Date.now());
  let seekDraft = $state<number | null>(null);
  $effect(() => {
    if (!playing) return;
    const t = setInterval(() => (clock = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const position = $derived.by(() => {
    const len = viaRoon?.nowPlaying?.length;
    if (!seekBase || !len) return null;
    const p = seekBase.seek + (playing ? Math.max(0, clock - seekBase.at) / 1000 : 0);
    return Math.min(len, p);
  });
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  async function seekTo(seconds: number) {
    if (!selected) return;
    try {
      await api.roonSeek(selected, seconds);
      seekBase = { seek: seconds, at: Date.now() };
    } catch (e) {
      message = { kind: "error", text: (e as Error).message };
    } finally {
      seekDraft = null;
    }
  }
  // Roon playing while this HQPlayer sits stopped usually means the wrong zone is mapped.
  let mismatchTicks = $state(0);
  $effect(() => {
    // Counts HQPlayer status polls (~1.5 s), not Roon's once-a-second seek updates.
    const m = snap?.status.state === 0 && untrack(() => roonZone?.state === "playing");
    mismatchTicks = m ? untrack(() => mismatchTicks) + 1 : 0;
  });
  /**
   * Measured 2026-10-02: a Pause sent to HQPlayer pauses the Roon zone, but Play and
   * Next don't reach Roon, so after a pause only Roon can resume. With Roon as the
   * source, leave transport to Roon.
   */
  const ROON_NOTE =
    "Playing from Roon: Stop stops HQPlayer; play, skip and resume are in Roon (or connect Roon in Settings → Roon)";
  // With a Roon zone, controls go to Roon (HQPlayer-side play/next don't reach Roon).
  const allowed = (a: "play" | "pause" | "previous" | "next") => (viaRoon ? viaRoon.allowed[a] : !fromRoon);
  async function transport(action: "play" | "pause" | "stop" | "previous" | "next") {
    if (!selected) return;
    tbusy = true;
    try {
      // The event stream brings the new state; the reply can predate the change.
      if (viaRoon && action !== "stop") await api.roonTransport(selected, action);
      else {
        const r = await api.transport(selected, action);
        if (snap) snap = { ...snap, status: r.status };
      }
    } catch (e) {
      message = { kind: "error", text: (e as Error).message };
    } finally {
      tbusy = false;
    }
  }

  const applyMajor = (what: string, change: Change) => {
    const ok = confirm(
      `Change ${what}?\n\nPlayback may pause for a few seconds. If it doesn't recover, the change is rolled back automatically.`,
    );
    if (ok) apply(change);
  };
  const undo = () => run("Undoing", () => api.undo(selected!));

  const vol = $derived(volDraft ?? snap?.state.volume ?? 0);
  const step = (d: number) => {
    if (!snap || !caps) return;
    const v = Math.min(caps.volumeRange.max, Math.max(caps.volumeRange.min, snap.state.volume + d));
    if (v !== snap.state.volume) apply({ volume: v });
  };
</script>

<main>
  <header class="top">
    <span class="brand" aria-label="hqpweb"><img src="/icon-192.png" alt="" width="22" height="22" />hqpweb</span>
    <!-- The status dot sits on the instance name it belongs to. -->
    <div class="inst" title={dotTitle}>
      <span class="dot {online}" class:slow={online === "live" && slow} aria-hidden="true"></span>
      {#if instances.length > 1}
        <select bind:value={selected} aria-label="Instance">
          {#each instances as i (i.id)}<option value={i.id}>{optionLabel(i)}</option>{/each}
        </select>
      {:else}
        <h1>{instances[0] ? optionLabel(instances[0]) : "No instances"}</h1>
      {/if}
    </div>
    <button class="gear" onclick={() => settings.open()} aria-label="Settings">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
        ><path
          fill="currentColor"
          d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
          transform="translate(-1 0)"
        /></svg
      >
    </button>
  </header>

  <Settings
    bind:this={settings}
    instance={instances.find((i) => i.id === selected) ?? null}
    {instances}
    onchange={refreshInstances}
    onforgot={() => selected && api.capabilities(selected).then((c) => (caps = c))}
  />

  {#if instances.length === 0}
    <p class="banner warn">No HQPlayer instances yet. Open Settings (⚙) to scan the network or add one by address.</p>
  {/if}

  {#if speedClass === "bad" && (processSpeed ?? speed) != null}
    <p class="banner warn">
      HQPlayer is falling behind real time ({(processSpeed ?? speed)!.toFixed(2)}×): it may be overloaded.
      {#if undoAvailable}Undo the last change below, or pick a lighter filter or modulator.{:else}Try a lighter filter or
        modulator.{/if}
    </p>
  {/if}
  {#if online === "live" && slow}
    <p class="banner warn">HQPlayer is answering slowly ({snap?.health?.latencyMs} ms); it may be overloaded.</p>
  {/if}

  {#if online === "unreachable"}
    <p class="banner error">HQPlayer unreachable: {offlineReason}</p>
  {:else if online === "lost"}
    <p class="banner warn">Lost connection to the app's server; retrying…</p>
  {/if}

  {#if snap}
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
        <!-- HQPlayer's own position: read-only. Length is 0 for streams such as Roon's. -->
        <div class="seek">
          <span>{mmss(snap.status.position)}</span>
          {#if snap.status.length > 0}
            <progress max={snap.status.length} value={Math.min(snap.status.position, snap.status.length)} aria-label="Position"
            ></progress>
            <span>{mmss(snap.status.length)}</span>
          {/if}
        </div>
      {/if}
      {#if mismatchTicks >= 3 && roonZone}
        <p class="mismatch">
          Roon is playing in “{roonZone.name}”, but this HQPlayer is stopped. If that zone isn't fed by this HQPlayer, pick
          another in Settings → Roon.
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
        {#if fromRoon && !viaRoon}
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
          <button class="round" onclick={() => step(prefs.volumeStep)} disabled={busy} aria-label="Up {prefs.volumeStep} dB"
            >+</button
          >
          <output>{vol.toFixed(1)}<small> dB</small></output>
        </div>
        {#if vol > RECOMMENDED_MAX_VOLUME_DB}
          <p class="vol-note">Above −3 dB: HQPlayer recommends −3 dB or lower when resampling, to avoid inter-sample overs.</p>
        {/if}
      {/if}
    </section>

    {#if caps}
      <!-- Most frequent jobs, kept above the fold: filters, then dither/modulator, then presets. -->
      <section class="card list quick" title="1x is used for sources below 50 kHz (44.1/48k), Nx for higher rates.">
        <Picker
          label="1x filter"
          hint={inUse === "1x" ? "in use" : ""}
          active={takenFor("1x", nameAt(caps.filters, snap.state.filter1x))}
          items={filterItems("1x")}
          current={nameAt(caps.filters, snap.state.filter1x)}
          disabled={busy}
          onpick={(i) => apply({ filter1x: i.name })}
        />
        <Picker
          label="Nx filter"
          hint={inUse === "Nx" ? "in use" : ""}
          active={takenFor("Nx", nameAt(caps.filters, snap.state.filterNx))}
          items={filterItems("Nx")}
          current={nameAt(caps.filters, snap.state.filterNx)}
          disabled={busy}
          onpick={(i) => apply({ filterNx: i.name })}
        />
      </section>
      <section class="card list quick">
        <Picker
          label={isSdm ? "Modulator" : "Dither"}
          active={snap.status.state === 2 ? snap.status.activeShaper === nameAt(caps.shapers, snap.state.shaper) : null}
          items={shaperItems}
          current={nameAt(caps.shapers, snap.state.shaper)}
          disabled={busy}
          onpick={(i) => apply({ shaper: i.name })}
        />
      </section>
      {#if selected}
        <section class="card list quick">
          <Presets
            instanceId={selected}
            stateKey={`${snap.state.mode}|${snap.state.rate}|${snap.state.filter1x}|${snap.state.filterNx}|${snap.state.shaper}|${snap.state.invert}|${snap.state.filter20k}|${snap.state.adaptive}|${snap.state.volume}|${snap.state.convolution}|${snap.state.matrixProfile}|${snap.status.source?.sampleRate ?? 0}`}
            {busy}
            {run}
          />
        </section>
      {/if}

      <details class="advanced" bind:open={advancedOpen}>
        <summary>Advanced</summary>
        <p class="help">These can stop playback. The app checks that playback recovers and rolls back if it doesn't.</p>
        <section class="card list">
          <Picker
            label="Mode"
            items={caps.modes}
            current={caps.mode.name}
            disabled={busy}
            onpick={(i) => applyMajor(`mode to ${i.name}`, { mode: i.name })}
          />
          {#if caps.rateSettable}
            <Picker
              label="Output rate"
              hint={snap.state.rate === 0 ? `now ${formatRate(snap.status.activeRate, caps.mode.name)}` : ""}
              items={rateItems}
              current={formatRate(caps.rates.find((r) => r.index === snap!.state.rate)?.rate ?? 0, caps.mode.name)}
              disabled={busy}
              onpick={(i) => applyMajor(`output rate to ${i.name}`, { rate: (i as (typeof rateItems)[number]).rate })}
            />
          {/if}
        </section>

        <h2 class="sub-h">Convolution and matrix</h2>
        <section class="card list">
          <label class="toggle">
            <span>Convolution</span>
            <input
              type="checkbox"
              role="switch"
              checked={snap.state.convolution}
              disabled={busy}
              onchange={(e) => toggle(e.currentTarget, "convolution")}
            />
          </label>
          {#if caps.matrixProfiles.length}
            <Picker
              label="Matrix profile"
              items={caps.matrixProfiles.map((name, index) => ({ index, name }))}
              current={snap.state.matrixProfile}
              disabled={busy}
              onpick={(i) => apply({ matrixProfile: i.name })}
            />
          {/if}
        </section>
        <p class="help">
          Impulse responses and matrix profiles are set up in HQPlayer itself (its Convolution and Matrix menus); the control API
          can only switch them.
          {#if !caps.matrixProfiles.length}No matrix profiles are set up on this instance.{/if}
        </p>

        <h2 class="sub-h">Options</h2>
        <section class="card list">
          {#each [["invert", "Invert polarity"], ["filter20k", "20 kHz filter"], ["adaptive", "Adaptive volume"]] as [key, label] (key)}
            {@const k = key as "invert" | "filter20k" | "adaptive"}
            <label class="toggle">
              <span>{label}</span>
              <input
                type="checkbox"
                role="switch"
                checked={snap.state[k]}
                disabled={busy}
                onchange={(e) => toggle(e.currentTarget, k)}
              />
            </label>
          {/each}
        </section>
      </details>
    {/if}
  {:else if online === "connecting" && instances.length}
    <p class="muted">Connecting…</p>
  {/if}
</main>

<footer class:show={footerOpen || (speedClass === "bad" && undoAvailable)}>
  {#if message}<p class="msg {message.kind}">{message.text}</p>{/if}
  {#if undoAvailable}<button class="undo" onclick={undo} disabled={busy}>Undo last change</button>{/if}
</footer>

<style>
  :global(body) {
    margin: 0;
    font-size: 16px;
    line-height: 1.4;
    -webkit-tap-highlight-color: transparent;
  }
  main {
    max-width: 34rem;
    margin: 0 auto;
    padding: 16px 16px 140px;
    padding-top: max(16px, env(safe-area-inset-top));
  }

  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .top h1 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gear {
    background: none;
    border: 0;
    color: var(--text-dim);
    padding: 8px;
    margin: -8px -8px -8px 0;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    display: grid;
    place-items: center;
  }
  .top select {
    flex: 1;
    min-width: 0;
    width: 100%;
    font: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: inherit;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-dim);
    flex: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-dim);
    font-size: 0.95rem;
    flex: none;
  }
  .brand img {
    border-radius: 6px;
  }
  .inst {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .quick {
    margin-top: 10px;
  }
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
  .dot.live {
    background: var(--ok);
  }
  .dot.live.slow {
    background: var(--warn);
  }
  .dot.unreachable,
  .dot.lost {
    background: var(--danger);
  }

  .banner {
    padding: 10px 14px;
    border-radius: 10px;
    margin: 0 0 12px;
  }
  .banner.error {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
  }
  .banner.warn {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    color: var(--warn);
  }

  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin: 22px 4px 8px;
    font-weight: 600;
  }
  .card {
    background: var(--bg-elev);
    border-radius: 14px;
  }
  .card.list {
    overflow: hidden;
  }
  .help {
    color: var(--text-dim);
    font-size: 0.82rem;
    margin: 6px 4px 0;
  }
  .muted {
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
  .seek input,
  .seek progress {
    flex: 1;
    accent-color: var(--accent);
  }
  .seek progress {
    height: 6px;
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

  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    cursor: pointer;
  }
  .toggle:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }
  .toggle input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent-text);
  }

  .advanced {
    margin-top: 22px;
  }
  .advanced summary {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    font-weight: 600;
    padding: 0 4px;
    cursor: pointer;
  }
  .advanced .help {
    margin: 8px 4px;
  }
  .sub-h {
    margin-top: 14px;
  }

  footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(12px);
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
