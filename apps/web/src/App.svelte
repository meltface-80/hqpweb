<script lang="ts">
  // Skeleton only: instance picker + live "Now" card (design §5, items 1–2).
  // Polling here is a stand-in for the server-sent events the design calls for.
  type Inst = { id: string; name: string };
  type Now = {
    info: { engine: string; platform: string };
    status: { state: number; activeMode: string; activeRate: number; activeFilter: string; activeShaper: string; volume: number };
  };

  let instances = $state<Inst[]>([]);
  let selected = $state<string | null>(null);
  let now = $state<Now | null>(null);
  let error = $state<string | null>(null);

  const STATES = ["stopped", "paused", "playing", "stopping"];

  function rate(hz: number, mode: string) {
    if (mode.startsWith("SDM") && hz % 44100 === 0) return `DSD${hz / 44100}`;
    return hz >= 1_000_000 ? `${hz / 1_000_000} MHz` : `${hz / 1000} kHz`;
  }

  $effect(() => {
    fetch("/api/instances")
      .then((r) => r.json())
      .then((list: Inst[]) => {
        instances = list;
        selected ??= list[0]?.id ?? null;
      })
      .catch((e) => (error = String(e)));
  });

  $effect(() => {
    const id = selected;
    if (!id) return;
    let live = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/instances/${id}/now`);
        const body = await r.json();
        if (!live) return;
        if (r.ok) {
          now = body;
          error = null;
        } else error = body.error;
      } catch (e) {
        if (live) error = String(e);
      }
    };
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  });
</script>

<main>
  <select bind:value={selected} aria-label="Instance">
    {#each instances as i (i.id)}<option value={i.id}>{i.name}</option>{/each}
  </select>

  {#if error}<p class="err">{error}</p>{/if}

  {#if now}
    <section class="card">
      <h2>{STATES[now.status.state]} · {now.status.activeMode} · {rate(now.status.activeRate, now.status.activeMode)}</h2>
      <dl>
        <dt>Filter</dt><dd>{now.status.activeFilter}</dd>
        <dt>{now.status.activeMode.startsWith("SDM") ? "Modulator" : "Dither"}</dt><dd>{now.status.activeShaper}</dd>
        <dt>Volume</dt><dd>{now.status.volume} dB</dd>
        <dt>Engine</dt><dd>{now.info.engine} ({now.info.platform})</dd>
      </dl>
    </section>
  {/if}
</main>

<style>
  :global(:root) { --bg: #fafafa; --fg: #1a1a1a; --card: #fff; --muted: #666; --err: #b00020; }
  @media (prefers-color-scheme: dark) {
    :global(:root) { --bg: #111; --fg: #eee; --card: #1c1c1c; --muted: #999; --err: #ff6b6b; }
  }
  :global(body) { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.4 system-ui, sans-serif; }
  main { max-width: 32rem; margin: 0 auto; padding: 16px; }
  select { font: inherit; padding: 0.4rem; width: 100%; }
  .card { background: var(--card); border-radius: 12px; padding: 16px; margin-top: 16px; }
  h2 { font-size: 1.1rem; margin: 0 0 0.75rem; text-transform: capitalize; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 1rem; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .err { color: var(--err); }
</style>
