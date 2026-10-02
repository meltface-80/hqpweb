<script lang="ts">
  // Live "Now" card, quick changes, Advanced (mode and rate), undo. Changes that
  // can disturb playback are checked by the server and rolled back if they fail.
  import Picker from "./lib/Picker.svelte";
  import Settings from "./lib/Settings.svelte";
  import { prefs } from "./lib/prefs.svelte.ts";
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
  let volDraft = $state<number | null>(null);
  let settings: Settings;

  $effect(() => {
    api
      .instances()
      .then((list) => {
        instances = list;
        selected = list.find((i) => i.id === remembered)?.id ?? list[0]?.id ?? null;
      })
      .catch((e) => (message = { kind: "error", text: `Can't reach the app's server: ${e.message}` }));
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
    const es = api.events(id);
    es.addEventListener("now", (e) => {
      snap = JSON.parse((e as MessageEvent).data);
      online = "live";
    });
    es.addEventListener("unreachable", (e) => {
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
    if (sr) return sr <= 48_000 ? "1x" : "Nx";
    return snap.state.filterInUse === snap.state.filter1x ? "1x" : "Nx";
  });

  const show = (field: keyof Change, v: string | number | boolean) =>
    field === "rate" ? formatRate(Number(v), caps?.mode.name ?? "") : field === "volume" ? `${v} dB` : String(v);

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
  const withWarn = <T extends { name: string }>(items: T[], field: "filterNx" | "filter1x" | "shaper") =>
    items.map((i) => ({ ...i, warn: warnFor(field, i.name) }));
  const rateItems = $derived(
    (caps?.rates ?? []).map((r) => ({
      index: r.index,
      name: formatRate(r.rate, caps!.mode.name),
      rate: r.rate,
      disabled: !r.allowed,
      note: r.note,
      warn: r.rate ? warnFor("rateHz", r.rate) : undefined,
    })),
  );

  function describe(r: ApplyResult) {
    if (r.rolledBack) {
      const back = r.rolledBack.results.map((x) => `${FIELD_LABEL[x.field]} back to ${show(x.field, x.actual)}`).join(", ");
      const rec: PlaybackCheck = r.rolledBack.playback;
      const tail =
        rec.kind === "playing" ? "Playback resumed."
        : rec.kind === "not-checked" ? ""
        : `Playback did not recover (${rec.detail}): HQPlayer may need a restart.`;
      return {
        kind: "warn" as const,
        text: `Rolled back: ${r.playback.detail}. ${back}. ${tail} Marked as not working on this instance.`,
      };
    }
    const failed = r.results.filter((x) => !x.applied);
    const notes = r.results.filter((x) => x.note).map((x) => `${FIELD_LABEL[x.field]} ${x.note}`);
    if (failed.length) {
      const text = failed
        .map((x) => `${FIELD_LABEL[x.field]}: asked for ${show(x.field, x.requested)}, HQPlayer reports ${show(x.field, x.actual)}`)
        .concat(notes)
        .join(" · ");
      return { kind: "warn" as const, text };
    }
    const text = r.results.map((x) => `${FIELD_LABEL[x.field]} → ${show(x.field, x.actual)}`);
    const pb =
      r.playback.kind === "playing" ? "playback OK"
      : r.playback.kind === "not-checked" && r.playback.detail?.startsWith("nothing") ? "not playing, so not checked"
      : r.playback.kind === "inconclusive" ? `playback not checked (${r.playback.detail})`
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

  const RISKY: (keyof Change)[] = ["mode", "rate", "filterNx", "filter1x", "shaper"];
  const apply = (change: Change) => {
    const risky = (Object.keys(change) as (keyof Change)[]).some((k) => RISKY.includes(k));
    const label = risky && snap?.status.state === 2 ? "Applying and checking playback" : "Applying";
    return run(label, () => api.change(selected!, change));
  };
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
    {#if instances.length > 1}
      <select bind:value={selected} aria-label="Instance">
        {#each instances as i (i.id)}<option value={i.id}>{i.name}</option>{/each}
      </select>
    {:else}
      <h1>{instances[0]?.name ?? "…"}</h1>
    {/if}
    <span class="dot {online}" title={online === "unreachable" ? offlineReason : online}></span>
    <button class="gear" onclick={() => settings.open()} aria-label="Settings">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>
    </button>
  </header>

  <Settings
    bind:this={settings}
    instance={instances.find((i) => i.id === selected) ?? null}
    onforgot={() => selected && api.capabilities(selected).then((c) => (caps = c))}
  />

  {#if online === "unreachable"}
    <p class="banner error">HQPlayer unreachable: {offlineReason}</p>
  {:else if online === "lost"}
    <p class="banner warn">Lost connection to the app's server; retrying…</p>
  {/if}

  {#if snap}
    <section class="card now">
      <div class="headline">
        <span class="state s{snap.status.state}">{PLAYBACK[snap.status.state]}</span>
        <span class="big">{formatRate(snap.status.activeRate, snap.status.activeMode)}</span>
        <span class="mode">{snap.status.activeMode}</span>
      </div>
      <dl>
        <dt>Filter</dt>
        <dd>
          {snap.status.activeFilter || "—"}
          {#if inUse}<span class="pill">{inUse}</span>{/if}
        </dd>
        <dt>{isSdm ? "Modulator" : "Dither"}</dt>
        <dd>{snap.status.activeShaper || "—"}</dd>
        {#if snap.status.source}
          <dt>Source</dt>
          <dd>{formatRate(snap.status.source.sampleRate, "PCM")} / {snap.status.source.bits}-bit</dd>
        {/if}
        {#if caps}<dt>Engine</dt><dd>{caps.engine}</dd>{/if}
      </dl>
    </section>

    {#if caps}
      <h2>Filters</h2>
      <section class="card list">
        <Picker
          label="Nx"
          hint={inUse === "Nx" ? "in use" : ""}
          items={withWarn(caps.filters, "filterNx")}
          current={nameAt(caps.filters, snap.state.filterNx)}
          disabled={busy}
          onpick={(i) => apply({ filterNx: i.name })}
        />
        <Picker
          label="1x"
          hint={inUse === "1x" ? "in use" : ""}
          items={withWarn(caps.filters, "filter1x")}
          current={nameAt(caps.filters, snap.state.filter1x)}
          disabled={busy}
          onpick={(i) => apply({ filter1x: i.name })}
        />
      </section>
      <p class="help">1x is used for 44.1/48 kHz sources, Nx for higher rates.</p>

      <h2>{isSdm ? "Modulator" : "Dither"}</h2>
      <section class="card list">
        <Picker
          label={isSdm ? "Modulator" : "Dither"}
          items={withWarn(caps.shapers, "shaper")}
          current={nameAt(caps.shapers, snap.state.shaper)}
          disabled={busy}
          onpick={(i) => apply({ shaper: i.name })}
        />
      </section>

      <h2>Volume</h2>
      <section class="card volume">
        <div class="vol-row">
          <button class="round" onclick={() => step(-prefs.volumeStep)} disabled={busy} aria-label="Down {prefs.volumeStep} dB">−</button>
          <output>{vol.toFixed(1)}<small> dB</small></output>
          <button class="round" onclick={() => step(prefs.volumeStep)} disabled={busy} aria-label="Up {prefs.volumeStep} dB">+</button>
        </div>
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
        />
        <div class="range"><span>{caps.volumeRange.min} dB</span><span>{caps.volumeRange.max} dB</span></div>
      </section>

      <details class="advanced" open={prefs.advancedOpen}>
        <summary>Advanced: mode and output rate</summary>
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
      </details>

      <h2>Options</h2>
      <section class="card list">
        {#each [["invert", "Invert polarity"], ["filter20k", "20 kHz filter"], ["adaptive", "Adaptive volume"]] as [key, label] (key)}
          {@const k = key as "invert" | "filter20k" | "adaptive"}
          <label class="toggle">
            <span>{label}</span>
            <input type="checkbox" role="switch" checked={snap.state[k]} disabled={busy} onchange={(e) => apply({ [k]: e.currentTarget.checked })} />
          </label>
        {/each}
      </section>
    {/if}
  {:else if online === "connecting"}
    <p class="muted">Connecting…</p>
  {/if}
</main>

<footer class:show={message || undoAvailable}>
  {#if message}<p class="msg {message.kind}">{message.text}</p>{/if}
  {#if undoAvailable}<button class="undo" onclick={undo} disabled={busy}>Undo last change</button>{/if}
</footer>

<style>
  :global(body) { margin: 0; font-size: 16px; line-height: 1.4; -webkit-tap-highlight-color: transparent; }
  main { max-width: 34rem; margin: 0 auto; padding: 16px 16px 140px; padding-top: max(16px, env(safe-area-inset-top)); }

  .top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .top h1 { font-size: 1.25rem; margin: 0; flex: 1; }
  .gear { background: none; border: 0; color: var(--text-dim); padding: 8px; margin: -8px -8px -8px 0; cursor: pointer; min-width: 44px; min-height: 44px; display: grid; place-items: center; }
  .top select { flex: 1; font: inherit; font-weight: 600; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-elev); color: inherit; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-dim); }
  .dot.live { background: var(--ok); }
  .dot.unreachable, .dot.lost { background: var(--danger); }

  .banner { padding: 10px 14px; border-radius: 10px; margin: 0 0 12px; }
  .banner.error { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
  .banner.warn { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }

  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin: 22px 4px 8px; font-weight: 600; }
  .card { background: var(--bg-elev); border-radius: 14px; }
  .card.list { overflow: hidden; }
  .help { color: var(--text-dim); font-size: 0.82rem; margin: 6px 4px 0; }
  .muted { color: var(--text-dim); }

  .now { padding: 16px; }
  .headline { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .state { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--bg-elev-2); color: var(--text-dim); align-self: center; }
  .state.s2 { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
  .state.s3 { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .big { font-size: 1.9rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .mode { color: var(--text-dim); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; }
  dt { color: var(--text-dim); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .pill { font-size: 0.72rem; padding: 1px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-text); margin-left: 4px; }

  .volume { padding: 16px; }
  .vol-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  output { font-size: 1.9rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  output small { font-size: 1rem; font-weight: 500; color: var(--text-dim); }
  .round { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--border); background: var(--bg); color: inherit; font-size: 1.5rem; cursor: pointer; }
  .round:disabled { opacity: 0.5; }
  input[type="range"] { width: 100%; accent-color: var(--accent-text); }
  .range { display: flex; justify-content: space-between; color: var(--text-dim); font-size: 0.78rem; }

  .toggle { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; cursor: pointer; }
  .toggle:not(:last-child) { border-bottom: 1px solid var(--border); }
  .toggle input { width: 20px; height: 20px; accent-color: var(--accent-text); }

  .advanced { margin-top: 22px; }
  .advanced summary { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); font-weight: 600; padding: 0 4px; cursor: pointer; }
  .advanced .help { margin: 8px 4px; }

  footer { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px max(12px, env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); border-top: 1px solid var(--border); display: none; flex-direction: column; gap: 8px; align-items: center; }
  footer.show { display: flex; }
  .msg { margin: 0; max-width: 34rem; text-align: center; font-size: 0.9rem; }
  .msg.ok { color: var(--ok); }
  .msg.warn { color: var(--warn); }
  .msg.error { color: var(--danger); }
  .msg.info { color: var(--text-dim); }
  .undo { font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--accent-text); cursor: pointer; }
</style>
