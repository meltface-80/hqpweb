<script lang="ts">
  // Live "Now" card, quick changes, Advanced (mode and rate), undo. Changes that
  // can disturb playback are checked by the server and rolled back if they fail.
  import { tick, untrack } from "svelte";
  import Picker from "./lib/Picker.svelte";
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
  import { offerReload } from "./lib/update.ts";
  import * as speedRules from "./lib/speed.ts";
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
  // ---- a newer hqpweb on the server ---------------------------------------------
  // An installed app (PWA) can stay open for days on old code, with no reload button.
  // The page knows the commit it was built from; when it comes back to the foreground,
  // and every 10 minutes, it asks the server. A difference offers a reload.
  let updated = $state(false);
  async function checkForUpdate() {
    if (import.meta.env.DEV || !__APP_COMMIT__ || updated) return; // no request when it couldn't matter
    const h = await api.health().catch(() => null);
    if (offerReload(__APP_COMMIT__, h?.commit, import.meta.env.DEV)) updated = true;
  }
  $effect(() => {
    const onVisible = () => document.visibilityState === "visible" && checkForUpdate();
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(checkForUpdate, 10 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  });

  const speed = $derived(snap?.health?.speed ?? null);
  let slowSince = $state<number | null>(null);
  $effect(() => {
    const low = speedRules.isSlow(speed);
    untrack(() => {
      if (!low) slowSince = null;
      else if (slowSince === null) slowSince = Date.now();
    });
  });
  const processSpeed = $derived(snap?.health?.processSpeed ?? null);
  // `snap` in the clock term re-evaluates on each update, so "slow for 15 s" can turn amber.
  const speedClass = $derived(
    speedRules.speedClass(processSpeed, speed, slowSince === null ? null : (snap ? Date.now() : 0) - slowSince),
  );
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
  let shaperPicker = $state<Picker>();
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
    setTimeout(() => (w?.cause === "modulator" ? shaperPicker : w?.slot === "filter1x" ? picker1x : pickerNx)?.open(), 0);
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

  const apply = (change: Change) => {
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

<main>
  <Header {instances} bind:selected {online} {slow} {dotTitle} onsettings={() => settings.open()} />
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

    {#if caps}
      <!-- Most frequent jobs, kept above the fold: filters, then dither/modulator, then presets. -->
      <section class="card list quick" title="1x is used for sources below 50 kHz (44.1/48k), Nx for higher rates.">
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
      </section>
      {#if otherSourceNotes.length}
        <p class="card-note">
          At a fixed {formatRate(outRate, caps.mode.name)}: {otherSourceNotes.join("; ")}. Auto avoids this.
        </p>
      {/if}
      <RateSwitch
        request={rateSwitch}
        onchoose={chooseRate}
        onalternative={chooseAlternative}
        oncancel={() => (rateSwitch = null)}
      />
      <section class="card list quick">
        <Picker
          bind:this={shaperPicker}
          label={isSdm ? "Modulator" : "Dither"}
          active={hints.shaperTaken(snap, nameAt(caps.shapers, snap.state.shaper))}
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

      <Advanced {caps} {snap} {busy} {rateItems} {apply} bind:open={advancedOpen} />
    {/if}
  {:else if online === "connecting" && instances.length}
    <p class="muted">Connecting…</p>
  {/if}
</main>

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
