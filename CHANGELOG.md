# Changelog

Pre-alpha: no version numbers yet, so entries are dated and name the commit.
**Read the "Upgrade notes" before updating.**

## Unreleased

### Upgrade notes

- **Renamed to hqpweb.** The container is now `hqpweb`, in a compose project of the
  same name. **Before** pulling this update, stop the old one, or the new container
  can't take the port:

  ```sh
  docker compose down
  git pull
  docker compose up -d --build
  ```

  The old image can then be removed: `docker image rm web-controller:local`.
- **Settings now live in a Docker volume, not the `./config` folder.** That
  removes the `chown` step from installing. If you configured instances in
  `config/instances.json`, copy them into the volume once after updating:

  ```sh
  docker compose cp config/instances.json controller:/config/
  docker compose restart
  ```

  (If you'd rather keep a folder you edit by hand, mount it yourself in a
  `docker-compose.override.yml`. It must be writable by uid 1000.)
- **`ALLOWED_HOSTS` is no longer needed for IP addresses,** only for hostnames.

### Added

- **Roon (optional, off by default):** now playing with cover art, a position
  slider that seeks, and play/pause, previous and next that act on the Roon zone
  feeding the selected HQPlayer. A small built-in client of Roon's extension API (no
  new dependencies); approval once in Roon → Settings → Extensions; a zone per
  HQPlayer chosen in Settings → Roon.
- **Stop only** when HQPlayer is playing from Roon and the Roon link isn't set up
  (play and next sent to HQPlayer don't reach Roon).
- **Settings tabs:** General and Roon.
- **"Processing"** in the Now card: "Real-time ✓", "Straining" (below 0.97× for
  15 s) or "Falling behind" (below 0.90×), from a 30 s least-squares fit of
  HQPlayer's position; the exact figure is in the tooltip. (Measured: a two-point
  8 s difference swung 0.91–1.07 during normal playback; the fit stayed 0.99–1.00.)
- **Layout:** wordmark and status dot beside the instance name (tooltip: response
  time, or since when it's been unreachable); volume on the Now card; then 1x
  filter, Nx filter, dither/modulator and presets in one card, above the fold on a
  phone. Presets are one row that opens a sheet (apply, save, edit).
- **Track position** from HQPlayer itself (read-only), with the length when
  HQPlayer knows it (files; a Roon stream reports none).
- **Library (server side only for now):** the API can list HQPlayer's own library
  and play an album or track (`PlaylistAdd`, then HQPlayer switches to its
  playlist; verified on Desktop 5.35). The page shows a library button only where
  a library exists, and browsing is "to come".
- **Transport:** previous, play/pause and next, disabled while Roon is the source
  (measured: a pause sent to HQPlayer reaches Roon, but play and next don't).

- **Presets:** saved from an instance's current settings (volume opt-in), shared
  across instances, previewed per instance, and applied with read-back and
  rollback. Settings an instance can't take are skipped and listed. "Update" re-saves
  a preset from the current settings.
- **Convolution on/off and matrix profile selection** (Advanced). Both are
  switch-only; they're set up in HQPlayer itself.
- **Live health:** a warning when playback falls behind real time or HQPlayer
  answers slowly, and polling backs off when it does.

## 2026-10-02 · 413f79b

### Upgrade notes

- **The default port changed from 8787 to 4380.** Bookmarks and reverse proxies that
  point at 8787 stop working after the update. Either update them, or keep the old
  port by adding `PORT=8787` to `.env`.

### Added

- Compatibility hints from HQPlayer's documented rules: filter ratio limits,
  modulator rate floors and dither guidance. Picker entries that won't play are
  marked, and rule-explained rollbacks aren't recorded as this machine's failures.
- `BIND_ADDRESS` in `.env` publishes the port on one interface only.

### Fixed

- `PORT` now works with host networking.
- `config/instances.example.json` no longer contains a development-only instance.

## 2026-10-02 · e29b27d

First pushed version: live status, quick changes, mode and rate with automatic
rollback, discovery, instance management, themes, and Docker install.
