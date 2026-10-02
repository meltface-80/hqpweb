<script lang="ts">
  // HQPlayer's own library on the selected instance: search, albums, tracks, play.
  // Playing takes over from Roon on that instance.
  import { api, formatRate, type Status } from "./api.ts";

  let { instanceId, onplayed }: { instanceId: string | null; onplayed: (status: Status) => void } = $props();

  type AlbumSummary = { hash: string; album: string; artist?: string; date?: string; genre?: string; rate?: number; bits?: number; trackCount: number };
  type Album = AlbumSummary & { tracks: { hash: string; song: string; number?: number; length?: number; artist?: string }[] };

  let dialog: HTMLDialogElement;
  let q = $state("");
  let albums = $state<AlbumSummary[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state("");
  let open1 = $state<Album | null>(null);
  let playing = $state(false);
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  export function open() {
    dialog.showModal();
    if (!albums.length) search(true);
  }

  async function search(reset: boolean) {
    if (!instanceId) return;
    const my = ++seq;
    loading = true;
    error = "";
    try {
      const r = await api.library(instanceId, q, reset ? 0 : albums.length);
      if (my !== seq) return;
      albums = reset ? r.albums : [...albums, ...r.albums];
      total = r.total;
    } catch (e) {
      if (my === seq) error = (e as Error).message;
    } finally {
      if (my === seq) loading = false;
    }
  }
  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(() => search(true), 250);
  }

  async function show(a: AlbumSummary) {
    if (!instanceId) return;
    try {
      open1 = await api.album(instanceId, a.hash);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function play(track: number) {
    if (!instanceId || !open1) return;
    if (!confirm(`Play "${open1.album}" on HQPlayer? This takes over from Roon on this instance.`)) return;
    playing = true;
    error = "";
    try {
      const r = await api.playAlbum(instanceId, open1.hash, track);
      onplayed(r.status);
      dialog.close();
    } catch (e) {
      error = `${(e as Error).message}. If the files moved since HQPlayer's last library scan, rescan in HQPlayer (File → Library…).`;
    } finally {
      playing = false;
    }
  }

  const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
</script>

<dialog bind:this={dialog} onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="sheet">
    <header>
      {#if open1}
        <button class="back" onclick={() => (open1 = null)} aria-label="Back">‹</button>
        <h3>{open1.album}</h3>
      {:else}
        <h3>Library</h3>
      {/if}
      <button class="close" onclick={() => dialog.close()} aria-label="Close">✕</button>
    </header>

    {#if error}<p class="err">{error}</p>{/if}

    {#if open1}
      <div class="album-head">
        <img src={`/api/instances/${instanceId}/library/art/${open1.hash}`} alt="" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
        <div>
          <b>{open1.artist ?? ""}</b>
          <small>{[open1.date, open1.genre, open1.rate ? `${formatRate(open1.rate, "PCM")}/${open1.bits}` : ""].filter(Boolean).join(" · ")}</small>
          <button class="primary" onclick={() => play(0)} disabled={playing}>{playing ? "Starting…" : "Play album"}</button>
        </div>
      </div>
      <ol class="tracks">
        {#each open1.tracks as t, i (t.hash)}
          <li>
            <button onclick={() => play(i)} disabled={playing}>
              <span class="n">{t.number ?? i + 1}</span>
              <span class="t">{t.song}{#if t.artist}<small> · {t.artist}</small>{/if}</span>
              <span class="d">{dur(t.length)}</span>
            </button>
          </li>
        {/each}
      </ol>
    {:else}
      <input class="search" type="search" bind:value={q} oninput={onInput} placeholder="Search artist, album, composer, genre…" autocomplete="off" />
      <p class="count">{loading && !albums.length ? "Loading…" : `${total} album${total === 1 ? "" : "s"}`}</p>
      {#if !loading && total === 0 && !q}
        <p class="empty">HQPlayer's library on this instance is empty. Add music in HQPlayer itself (File → Library… → New scan); the control API can't add folders.</p>
      {/if}
      <ul class="albums">
        {#each albums as a (a.hash)}
          <li>
            <button onclick={() => show(a)}>
              <b>{a.album}</b>
              <small>{[a.artist, a.date, `${a.trackCount} tracks`].filter(Boolean).join(" · ")}</small>
            </button>
          </li>
        {/each}
      </ul>
      {#if albums.length < total}
        <button class="more" onclick={() => search(false)} disabled={loading}>{loading ? "Loading…" : "More"}</button>
      {/if}
    {/if}
  </div>
</dialog>

<style>
  dialog { padding: 0; border: 0; background: transparent; width: min(100%, 40rem); max-width: 100%; max-height: 100%; margin: auto auto 0; color: var(--text); }
  @media (min-width: 40rem) { dialog { margin: auto; } }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  .sheet { background: var(--bg-elev); border-radius: 16px 16px 0 0; height: 90vh; display: flex; flex-direction: column; padding-bottom: env(safe-area-inset-bottom); }
  @media (min-width: 40rem) { .sheet { border-radius: 16px; height: 85vh; } }
  header { display: flex; align-items: center; gap: 8px; padding: 14px 16px 8px; }
  h3 { margin: 0; font-size: 1.05rem; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close, .back { background: none; border: 0; color: var(--text-dim); font-size: 1.2rem; padding: 6px 8px; cursor: pointer; min-height: 40px; }
  .search { margin: 0 16px 6px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: inherit; font: inherit; }
  .count { margin: 0 16px 6px; color: var(--text-dim); font-size: 0.82rem; }
  .empty, .err { margin: 6px 16px; font-size: 0.9rem; }
  .empty { color: var(--text-dim); }
  .err { color: var(--danger); }
  ul, ol { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
  .albums button, .tracks button { width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--border); color: inherit; font: inherit; padding: 10px 16px; cursor: pointer; min-height: 44px; }
  .albums button { display: flex; flex-direction: column; gap: 2px; }
  .albums small, .album-head small { color: var(--text-dim); font-size: 0.82rem; }
  .albums button:hover, .tracks button:hover { background: var(--bg-elev-2); }
  .more { margin: 8px 16px 12px; font: inherit; padding: 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); color: var(--accent-text); cursor: pointer; }
  .album-head { display: flex; gap: 14px; align-items: center; padding: 6px 16px 12px; }
  .album-head img { width: 96px; height: 96px; border-radius: 8px; object-fit: cover; background: var(--bg-elev-2); }
  .album-head div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .primary { align-self: flex-start; margin-top: 6px; font: inherit; font-weight: 600; padding: 9px 18px; border-radius: 999px; border: 0; background: var(--accent); color: var(--on-accent); cursor: pointer; }
  .primary:disabled { opacity: 0.6; }
  .tracks button { display: grid; grid-template-columns: 2rem 1fr auto; gap: 8px; align-items: baseline; }
  .n, .d { color: var(--text-dim); font-variant-numeric: tabular-nums; font-size: 0.85rem; }
  .t small { color: var(--text-dim); }
</style>
