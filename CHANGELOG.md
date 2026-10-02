# Changelog

Pre-alpha: no version numbers yet, so entries are dated and name the commit.
**Read the "Upgrade notes" before updating.**

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
