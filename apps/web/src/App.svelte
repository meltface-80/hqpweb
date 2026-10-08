<script lang="ts">
  // Live "Now" card, quick changes, Advanced (mode and rate), undo. Changes that
  // can disturb playback are checked by the server and rolled back if they fail.
  import { tick, untrack } from "svelte";
  import Picker from "./lib/Picker.svelte";
  import AdviceSheet from "./lib/AdviceSheet.svelte";
  import Settings from "./lib/Settings.svelte";
  import Presets from "./lib/Presets.svelte";
  import Footer from "./lib/Footer.svelte";
  import Header from "./lib/Header.svelte";
  import Advanced from "./lib/Advanced.svelte";
  import NowCard from "./lib/NowCard.svelte";
  import RateSwitch, { type RateSwitchRequest } from "./lib/RateSwitch.svelte";
  import { prefs } from "./lib/prefs.svelte.ts";
  import { describe, type ResultMessage } from "./lib/result.ts";
  import { control, isRisky } from "./lib/control.ts";
  import * as hints from "./lib/hints.ts";
  import { watchForUpdate } from "./lib/update.ts";
  import * as speedRules from "./lib/speed.ts";
  import { recentChange, restartSteps } from "./lib/recovery.ts";
  import StatusBanners from "./lib/StatusBanners.svelte";
  import LayoutV2 from "./lib/LayoutV2.svelte";
  import HistorySheet from "./lib/HistorySheet.svelte";
  import { dacName, hasDacs, scopeOf } from "./lib/dac-scope.ts";
  import { nameAt } from "./lib/hints.ts";
  import { isApodizing, filterSlot } from "@app/protocol/compat";
  import {
    api,
    formatRate,
    type ApplyResult,
    type Capabilities,
    type Change,
    type Inst,
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
  // The DAC in use (dac-scope.ts) decides which failures are known here: reload on a switch.
  const selInst = $derived(instances.find((i) => i.id === selected) ?? null);
  const dacInUse = $derived(selInst?.dac);
  let dacSeen: string | undefined;
  $effect(() => {
    const d = dacInUse;
    untrack(() => {
      if (dacSeen !== undefined && d !== dacSeen && selected)
        api
          .capabilities(selected)
          .then((c) => (caps = c))
          .catch(() => {}); // on failure the known failures stay as they were until the next load
      dacSeen = d;
    });
  });
  let online = $state<"connecting" | "live" | "unreachable" | "lost">("connecting");
  let offlineReason = $state("");
  let busy = $state(false);
  let undoAvailable = $state(false);
  let message = $state<ResultMessage | null>(null);
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
  // ---- a newer hqpweb on the server: offer a reload (lib/update.ts) ------------
  let updated = $state(false);
  $effect(() => watchForUpdate(__APP_COMMIT__, import.meta.env.DEV, api.health, () => (updated = true)));

  const speed = $derived(snap?.health?.speed ?? null);
  let slowSince = $state<number | null>(null);
  $effect(() => {
    const low = speedRules.isSlow(speed);
    untrack(() => {
      if (!low) slowSince = null;
      else if (slowSince === null) slowSince = Date.now();
    });
  });
  const restart = $derived(restartSteps(instances.find((i) => i.id === selected)?.product));
  const processSpeed = $derived(snap?.health?.processSpeed ?? null);
  /** Readings in a row below real time: the alarm waits for a few (speed.ts, SUSTAIN). */
  let behind = $state(0);
  // `snap` in the clock term re-evaluates on each update, so "slow for 15 s" can turn amber.
  const speedClass = $derived(
    speedRules.speedClass(processSpeed, speed, slowSince === null ? null : (snap ? Date.now() : 0) - slowSince),
  );
  /** HQPlayer's own figure must stay below 1× for a while; the position fit has its own timing. */
  const fallingBehind = $derived(processSpeed != null ? speedRules.lasting(behind) : speedClass === "bad" && speed != null);
  const speedText = $derived(speedRules.speedText(processSpeed, speed, speedClass));
  const speedTitle = $derived(speedRules.speedTitle(processSpeed, speed));
  let offlineSince = $state<Date | null>(null);
  const slow = $derived(speedRules.answersSlowly(snap?.health?.latencyMs));
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
      behind = speedRules.behindStreak(behind, snap?.health?.processSpeed ?? null);
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

  // The rules behind every hint live in lib/hints.ts; these are thin views of them.
  const ctx = $derived(caps && snap ? hints.context(caps, snap) : null);
  const isSdm = $derived(ctx?.isSdm ?? false);
  const source = $derived(ctx?.source ?? 0);
  const outRate = $derived(ctx?.outRate ?? 0);
  const inUseFilter = $derived(ctx?.inUseFilter ?? "");
  const inUseApodizing = $derived(inUseFilter ? isApodizing(inUseFilter) : undefined);
  const filterItems = (slot: "1x" | "Nx") => (ctx ? hints.filterItems(ctx, slot) : []);
  const ratioLabel = $derived(ctx ? hints.ratioLabel(ctx) : "");
  const rateOptions = (filter: string) => (ctx ? hints.rateOptions(ctx, filter) : { options: [], auto: false });
  const wedge = $derived(ctx ? hints.wedge(ctx) : null);
  const otherSourceNotes = $derived(ctx ? hints.otherSourceNotes(ctx) : []);
  const shaperItems = $derived(ctx ? hints.shaperItems(ctx) : []);
  const rateItems = $derived(ctx ? hints.rateItems(ctx) : []);
  const inUse = $derived(snap ? hints.inUseSlot(snap) : null);
  let historySheet = $state<HistorySheet>();

  const show = (field: keyof Change, v: string | number | boolean) =>
    field === "rate" ? formatRate(Number(v), caps?.mode.name ?? "") : field === "volume" ? `${v} dB` : String(v);

  const takenFor = (slot: "1x" | "Nx", name: string) => (snap ? hints.filterTaken(snap, inUse, slot, name) : null);

  // ---- incompatible filter or rate: offer output rates that fit -----------------
  // One sheet at a time: a picker closes before the rate sheet opens, and the rate
  // sheet closes before "Choose another…" opens a picker.
  type Slot = "filter1x" | "filterNx";
  let rateSwitch = $state<(RateSwitchRequest & { field: Slot | null }) | null>(null);
  function pickFilter(field: Slot, item: { name: string; blocked?: string }) {
    if (!item.blocked || !caps) return apply({ [field]: item.name });
    rateSwitch = {
      kind: "pick",
      field,
      filter: item.name,
      title: `${item.name} can't play at this rate`,
      reason: `${item.name} ${item.blocked}`,
      playing: snap?.status.state === 2,
      ...rateOptions(item.name),
    };
  }
  function chooseRate(rate: number | null) {
    const r = rateSwitch;
    rateSwitch = null;
    if (!r) return;
    if (r.kind === "wedge") return rate === null ? undefined : apply({ rate });
    apply(rate === null ? { [r.field!]: r.filter } : { [r.field!]: r.filter, rate });
  }

  // ---- a queued track that can't start (guard 1; the rule is hints.wedge) -----------
  // Say why and offer rates, but leave Play to the user: no surprise playback.
  let picker1x = $state<Picker>();
  let pickerNx = $state<Picker>();
  let shaperPicker = $state<AdviceSheet>();
  function fixWedge() {
    if (!wedge) return;
    rateSwitch = {
      kind: "wedge",
      field: null,
      filter: wedge.filter,
      title: "The next track won't start",
      reason: wedge.text,
      playing: false,
      alternative: wedge.cause === "filter" ? "Choose another filter" : `Choose another ${isSdm ? "modulator" : "dither"}`,
      ...rateOptions(wedge.filter),
    };
  }
  async function chooseAlternative() {
    const w = wedge;
    rateSwitch = null;
    await tick();
    // Let the sheet finish closing before the picker opens.
    // The list shows which ones won't play here, so the wedge opens it rather than the guide.
    setTimeout(() => {
      if (w?.cause === "modulator") shaperPicker?.open({ tab: "list" });
      else (w?.slot === "filter1x" ? picker1x : pickerNx)?.open();
    }, 0);
  }

  // ---- HQPlayer's apodization and clip counters ---------------------------------
  function suggestApodizing() {
    const slot = source && filterSlot(source) === "Nx" ? pickerNx : picker1x;
    slot?.open({ chips: ["apodizing"] });
  }

  async function run(label: string, fn: () => Promise<ApplyResult>) {
    if (!selected || busy) return;
    busy = true;
    const wasFromRoon = fromRoon;
    message = { kind: "info", text: `${label}…` };
    try {
      const r = await fn();
      if (snap) snap = { ...snap, state: r.state };
      undoAvailable = r.undoAvailable;
      message = describe(r, show, wasFromRoon);
      // A rollback teaches the server a failed combination: refresh the warnings.
      if (r.rolledBack && selected) caps = await api.capabilities(selected);
    } catch (e) {
      message = { kind: "error", text: (e as Error).message };
    } finally {
      busy = false;
      volDraft = null;
    }
  }

  /** When the last change that could overload HQPlayer was made (recovery.ts, recentChange). */
  let riskyAt = $state<number | null>(null);
  // `snap` re-evaluates this on each update, so the window closes on its own.
  const lastChange = $derived(
    snap && recentChange(riskyAt, Date.now())
      ? new Date(riskyAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null,
  );
  const apply = (change: Change) => {
    if (isRisky(change)) riskyAt = Date.now();
    const label = isRisky(change) && snap?.status.state === 2 ? "Applying and checking playback" : "Applying";
    return run(label, () => api.change(selected!, change));
  };

  // Roon's zone for this instance, when Roon is on and a zone is mapped.
  let roonZone = $state<RoonZone | null>(null);
  // Roon's position: the server sends it only when it jumps; the card advances it locally.
  let seekBase = $state<{ seek: number; at: number } | null>(null);
  const fromRoon = $derived(control(snap, roonZone).fromRoon);

  const undo = () => run("Undoing", () => api.undo(selected!));
  /** After a rollback left HQPlayer's own playlist stopped: Stop, then Play (resumed it once when measured, not once). */
  async function restartPlayback() {
    if (!selected) return;
    message = { kind: "info", text: "Restarting playback…" };
    try {
      await api.transport(selected, "stop");
      await new Promise((r) => setTimeout(r, 500));
      const r = await api.transport(selected, "play");
      if (snap) snap = { ...snap, status: r.status };
      message = r.notStarted
        ? { kind: "warn", text: "HQPlayer didn't start. Restart HQPlayer, then check its volume." }
        : { kind: "ok", text: "✓ Playback restarted" };
    } catch (e) {
      message = { kind: "error", text: (e as Error).message };
    }
  }
</script>

<main class:wide={prefs.layout === "v2"}>
  <Header {instances} bind:selected {online} {slow} {dotTitle} onsettings={() => settings.open()} ondacs={refreshInstances} />
  {#if updated}
    <p class="updated">
      hqpweb has been updated. <button class="link" onclick={() => location.reload()}>Reload</button>
    </p>
  {/if}

  <Settings
    bind:this={settings}
    instance={instances.find((i) => i.id === selected) ?? null}
    {instances}
    onchange={refreshInstances}
    onforgot={() => selected && api.capabilities(selected).then((c) => (caps = c))}
  />

  <StatusBanners
    noInstances={instances.length === 0}
    {fallingBehind}
    speed={processSpeed ?? speed}
    {lastChange}
    {undoAvailable}
    slowMs={online === "live" && slow ? (snap?.health?.latencyMs ?? null) : null}
    {online}
    {offlineReason}
    {restart}
  />

  {#snippet nowCard()}
    {#if snap}
      <NowCard
        {selected}
        {snap}
        {caps}
        {roonZone}
        bind:seekBase
        bind:volDraft
        {busy}
        {apply}
        {wedge}
        {inUseFilter}
        {inUseApodizing}
        {speedClass}
        {speedText}
        {speedTitle}
        onfixwedge={fixWedge}
        onsuggestapodizing={suggestApodizing}
        onstatus={(status) => snap && (snap = { ...snap, status })}
        onmessage={(m) => (message = m)}
      />
    {/if}
  {/snippet}
  {#snippet filters()}
    {#if snap && caps}
      <Picker
        bind:this={picker1x}
        label="1x filter"
        hint={inUse === "1x" ? "in use" : ""}
        active={takenFor("1x", nameAt(caps.filters, snap.state.filter1x))}
        items={filterItems("1x")}
        groupByRating={prefs.filterOrder === "rating"}
        current={nameAt(caps.filters, snap.state.filter1x)}
        disabled={busy}
        {ratioLabel}
        onpick={(i) => pickFilter("filter1x", i)}
      />
      <Picker
        bind:this={pickerNx}
        label="Nx filter"
        hint={inUse === "Nx" ? "in use" : ""}
        active={takenFor("Nx", nameAt(caps.filters, snap.state.filterNx))}
        items={filterItems("Nx")}
        groupByRating={prefs.filterOrder === "rating"}
        current={nameAt(caps.filters, snap.state.filterNx)}
        disabled={busy}
        {ratioLabel}
        onpick={(i) => pickFilter("filterNx", i)}
      />
    {/if}
  {/snippet}
  {#snippet shaping()}
    {#if snap && caps}
      <AdviceSheet
        bind:this={shaperPicker}
        {isSdm}
        active={hints.shaperTaken(snap, nameAt(caps.shapers, snap.state.shaper))}
        items={shaperItems}
        current={nameAt(caps.shapers, snap.state.shaper)}
        disabled={busy}
        instanceId={selected}
        setup={instances.find((i) => i.id === selected)?.setup ?? {}}
        rateHz={outRate}
        rateText={outRate ? formatRate(outRate, caps.mode.name) : ""}
        {processSpeed}
        rates={caps.rates.filter((r) => r.allowed).map((r) => r.rate)}
        check={(c) => (ctx ? hints.checkPair(ctx, c) : null)}
        onpick={(name) => apply({ shaper: name })}
        onpickpair={(c) => apply(c.rateHz === outRate ? { shaper: c.shaper } : { rate: c.rateHz, shaper: c.shaper })}
        onpcm={() => apply({ mode: "PCM" })}
        result={message}
        onsaved={refreshInstances}
      />
    {/if}
  {/snippet}

  {#snippet presets()}
    {#if snap && selected}
      <Presets
        instanceId={selected}
        stateKey={`${snap.state.mode}|${snap.state.rate}|${snap.state.filter1x}|${snap.state.filterNx}|${snap.state.shaper}|${snap.state.invert}|${snap.state.filter20k}|${snap.state.adaptive}|${snap.state.volume}|${snap.state.convolution}|${snap.state.matrixProfile}|${snap.status.source?.sampleRate ?? 0}|${dacInUse}`}
        {busy}
        {run}
        dacScope={selInst && hasDacs(selInst) ? scopeOf(selInst.id, selInst.dac) : null}
      />
    {/if}
  {/snippet}
  {#snippet below()}
    {#if snap && caps}
      {#if otherSourceNotes.length}
        <p class="card-note">
          At a fixed {formatRate(outRate, caps.mode.name)}: {otherSourceNotes.join("; ")}. Auto avoids this.
        </p>
      {/if}
      {#if selected}<section class="card list quick">{@render presets()}</section>{/if}
      <Advanced {caps} {snap} {busy} {rateItems} {apply} bind:open={advancedOpen} modeAndRate={false} />
    {/if}
  {/snippet}

  {#if snap}
    <!-- While HQPlayer doesn't answer, what's shown is its last known state: dimmed and inert. -->
    <div class="live" class:stale={online === "unreachable"} inert={online === "unreachable" || undefined}>
      {#if prefs.layout === "v2" && caps}
        <LayoutV2
          {caps}
          {snap}
          {busy}
          {apply}
          {rateItems}
          {inUseFilter}
          {source}
          {outRate}
          dacName={selInst && hasDacs(selInst) ? dacName(selInst) : undefined}
          resume={snap.status.state !== 2 ? "stopped" : roonZone ? "roon-linked" : fromRoon ? "roon" : "hqplayer"}
          {speedClass}
          {speedText}
          {nowCard}
          {filters}
          {shaping}
          {below}
          onguide={() => shaperPicker?.open({ tab: "guide" })}
          onhistory={() => historySheet?.open()}
          selected={selected!}
          {roonZone}
          onstatus={(status) => snap && (snap = { ...snap, status })}
          onmessage={(m) => (message = m)}
        />
      {:else}
        {@render nowCard()}
        {#if caps}
          <!-- Most frequent jobs, kept above the fold: filters, then dither/modulator, then presets. -->
          <section class="card list quick" title="1x is used for sources below 50 kHz (44.1/48k), Nx for higher rates.">
            {@render filters()}
          </section>
          {#if otherSourceNotes.length}
            <p class="card-note">
              At a fixed {formatRate(outRate, caps.mode.name)}: {otherSourceNotes.join("; ")}. Auto avoids this.
            </p>
          {/if}
          <section class="card list quick">{@render shaping()}</section>
          {#if selected}<section class="card list quick">{@render presets()}</section>{/if}
          <Advanced {caps} {snap} {busy} {rateItems} {apply} bind:open={advancedOpen} />
        {/if}
      {/if}
      {#if caps}
        <RateSwitch
          request={rateSwitch}
          onchoose={chooseRate}
          onalternative={chooseAlternative}
          oncancel={() => (rateSwitch = null)}
        />
      {/if}
    </div>
  {:else if online === "connecting" && instances.length}
    <p class="muted">Connecting…</p>
  {/if}
</main>

<HistorySheet bind:this={historySheet} instanceId={selected} />

<Footer
  show={footerOpen || (speedClass === "bad" && undoAvailable)}
  {message}
  {busy}
  {undoAvailable}
  onrestart={restartPlayback}
  onundo={undo}
/>

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

  .quick {
    margin-top: 10px;
  }
  .stale {
    opacity: 0.45;
    filter: grayscale(0.6);
  }
  .card {
    background: var(--bg-elev);
    border-radius: 14px;
  }
  .card.list {
    overflow: hidden;
  }
  .muted {
    color: var(--text-dim);
  }

  .updated {
    margin: 0 0 12px;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--text);
    font-size: 0.9rem;
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
  .card-note {
    margin: 2px 20px 16px;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--warn);
  }
</style>
