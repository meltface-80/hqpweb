<script lang="ts">
  // PoC: live "Now" card + quick changes (filters, modulator/dither, volume,
  // toggles) + undo. Mode and rate come with the rollback engine.
  import Picker from "./lib/Picker.svelte";
  import {
    api,
    formatRate,
    FIELD_LABEL,
    PLAYBACK,
    type ApplyResult,
    type Capabilities,
    type Inst,
    type QuickChange,
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

  function describe(r: ApplyResult) {
    const failed = r.results.filter((x) => !x.applied);
    const notes = r.results.filter((x) => x.note).map((x) => `${FIELD_LABEL[x.field]} ${x.note}`);
    if (failed.length) {
      const text = failed
        .map((x) => `${FIELD_LABEL[x.field]}: asked for ${x.requested}, HQPlayer reports ${x.actual}`)
        .concat(notes)
        .join(" · ");
      return { kind: "warn" as const, text };
    }
    const text = r.results.map((x) => `${FIELD_LABEL[x.field]} → ${x.actual}${x.field === "volume" ? " dB" : ""}`);
    return { kind: "ok" as const, text: ["✓ " + text.join(", "), ...notes].join(" · ") };
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
    } catch (e) {
      message = { kind: "error", text: (e as Error).message };
    } finally {
      busy = false;
      volDraft = null;
    }
  }

  const apply = (change: QuickChange) => run("Applying", () => api.quick(selected!, change));
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
  </header>

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
          items={caps.filters}
          current={nameAt(caps.filters, snap.state.filterNx)}
          disabled={busy}
          onpick={(n) => apply({ filterNx: n })}
        />
        <Picker
          label="1x"
          hint={inUse === "1x" ? "in use" : ""}
          items={caps.filters}
          current={nameAt(caps.filters, snap.state.filter1x)}
          disabled={busy}
          onpick={(n) => apply({ filter1x: n })}
        />
      </section>
      <p class="help">1x is used for 44.1/48 kHz sources, Nx for higher rates.</p>

      <h2>{isSdm ? "Modulator" : "Dither"}</h2>
      <section class="card list">
        <Picker
          label={isSdm ? "Modulator" : "Dither"}
          items={caps.shapers}
          current={nameAt(caps.shapers, snap.state.shaper)}
          disabled={busy}
          onpick={(n) => apply({ shaper: n })}
        />
      </section>

      <h2>Volume</h2>
      <section class="card volume">
        <div class="vol-row">
          <button class="round" onclick={() => step(-1)} disabled={busy} aria-label="Down 1 dB">−</button>
          <output>{vol.toFixed(1)}<small> dB</small></output>
          <button class="round" onclick={() => step(1)} disabled={busy} aria-label="Up 1 dB">+</button>
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
  :global(:root) {
    --bg: #f4f4f6; --fg: #17171a; --card: #ffffff; --muted: #6b6b76; --line: #e6e6ea; --hover: #f1f1f4;
    --accent: #4f46e5; --accent-soft: #eef0ff; --ok: #157f3b; --warn: #a15c00; --err: #b3261e;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #0e0e11; --fg: #ececf1; --card: #1a1a1f; --muted: #9a9aa6; --line: #2a2a31; --hover: #23232a;
      --accent: #a5a1ff; --accent-soft: #2a2850; --ok: #6fdc8c; --warn: #f1b54a; --err: #ff8a80;
      color-scheme: dark;
    }
  }
  :global(body) { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.4 system-ui, -apple-system, sans-serif; -webkit-tap-highlight-color: transparent; }
  main { max-width: 34rem; margin: 0 auto; padding: 16px 16px 140px; padding-top: max(16px, env(safe-area-inset-top)); }

  .top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .top h1 { font-size: 1.25rem; margin: 0; flex: 1; }
  .top select { flex: 1; font: inherit; font-weight: 600; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: inherit; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); }
  .dot.live { background: var(--ok); }
  .dot.unreachable, .dot.lost { background: var(--err); }

  .banner { padding: 10px 14px; border-radius: 10px; margin: 0 0 12px; }
  .banner.error { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); }
  .banner.warn { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }

  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 22px 4px 8px; font-weight: 600; }
  .card { background: var(--card); border-radius: 14px; }
  .card.list { overflow: hidden; }
  .help { color: var(--muted); font-size: 0.82rem; margin: 6px 4px 0; }
  .muted { color: var(--muted); }

  .now { padding: 16px; }
  .headline { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .state { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--hover); color: var(--muted); align-self: center; }
  .state.s2 { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
  .state.s3 { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .big { font-size: 1.9rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .mode { color: var(--muted); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .pill { font-size: 0.72rem; padding: 1px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); margin-left: 4px; }

  .volume { padding: 16px; }
  .vol-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  output { font-size: 1.9rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  output small { font-size: 1rem; font-weight: 500; color: var(--muted); }
  .round { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: inherit; font-size: 1.5rem; cursor: pointer; }
  .round:disabled { opacity: 0.5; }
  input[type="range"] { width: 100%; accent-color: var(--accent); }
  .range { display: flex; justify-content: space-between; color: var(--muted); font-size: 0.78rem; }

  .toggle { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; cursor: pointer; }
  .toggle:not(:last-child) { border-bottom: 1px solid var(--line); }
  .toggle input { width: 20px; height: 20px; accent-color: var(--accent); }

  footer { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px max(12px, env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); border-top: 1px solid var(--line); display: none; flex-direction: column; gap: 8px; align-items: center; }
  footer.show { display: flex; }
  .msg { margin: 0; max-width: 34rem; text-align: center; font-size: 0.9rem; }
  .msg.ok { color: var(--ok); }
  .msg.warn { color: var(--warn); }
  .msg.error { color: var(--err); }
  .msg.info { color: var(--muted); }
  .undo { font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--accent); cursor: pointer; }
</style>
