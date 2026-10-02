# Changelog

Pre-alpha: no version numbers yet, so entries are dated and name the commit.
**Read the "Upgrade notes" before updating.**

## Unreleased

### Upgrade notes

- **Renamed to hqpwc.** The container is now `hqpwc`, in a compose project of the
  same name. **Before** pulling this update, stop the old one, or the new container
  can't take the port:

  ```sh
  docker compose down
  git pull
  docker compose up -d --build
  ```
- **Settings now live in a Docker volume, not the `./config` folder.** That
  removes the `chown` step from installing. If you configured instances in
  `config/instances.json`, copy them into the volume once after updating:

  ```sh
  docker compose cp config/. controller:/config
  docker compose restart
  ```

  (If you'd rather keep a folder you edit by hand, mount it yourself in a
  `docker-compose.override.yml`. It must be writable by uid 1000.)
- **`ALLOWED_HOSTS` is no longer needed for IP addresses,** only for hostnames.

### Added

- **Library:** browse HQPlayer's own library (search, albums, tracks) and play an
  album or track. Playing queues the files with `PlaylistAdd`; that path is not yet
  tested on a real instance.
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

### Data

- `config/presets.json` is new (written by the app). It lives in the same `config/`
  folder, so the existing volume and ownership cover it.

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
