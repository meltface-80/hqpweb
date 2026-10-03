# Changelog

Versions follow [semantic versioning](https://semver.org). Before 1.0, any release
may change behaviour; upgrade notes say what you need to do.

## 0.1.0-alpha.1 — first public release

**Install:** see the README. **Update:** `git pull && docker compose up -d --build`.

### What's in it

- **Instances:** discovery on the local network segment (with host networking), or
  add by address; rename; the name defaults to the one HQPlayer reports.
- **Now card:** output rate, mode, source format, playback state, track position,
  and **Processing** (whether HQPlayer keeps up with real time: Real-time ✓,
  Straining or Falling behind, from a 30 s fit of its position), plus volume.
- **Quick changes:** 1x and Nx filters, dither or modulator, volume, with hints
  from HQPlayer's documented rules on combinations that won't play.
- **Advanced:** mode, output rate, convolution on/off, matrix profile, polarity,
  20 kHz filter, adaptive volume.
- **Checked and reversible:** every change is read back; a change that stops
  playback or leaves HQPlayer unable to keep up is rolled back, remembered, and
  warned about next time. Undo for the last change. Volume is never raised more than
  6 dB at once, and undo and rollback never raise it.
- **Presets:** named sets of settings shared across instances, previewed per
  instance (active, quick or major change), saved with or without volume.
- **Transport:** previous, play/pause and next. With Roon as the source and no Roon
  link, only Stop (play and next sent to HQPlayer don't reach Roon).
- **Roon (optional, off by default):** now playing with cover art, a seek slider and
  working transport for the Roon zone that feeds each HQPlayer.
- **Install:** one Docker container, settings in a Docker volume, no login (see
  Security in the README).

### Known limits

- Tested on HQPlayer Desktop 5 (macOS and Linux). Embedded, HQPlayer 6 and Windows
  are untested.
- HQPlayer's saved configurations and its output device can't be switched: the
  control protocol doesn't allow it (README: "Why can't I switch profiles or
  endpoints?").
- Discovery doesn't cross VLANs or routed subnets; add instances by address.

### For the two pre-release installs

If you ran a build from before this release: the container is now `hqpweb` (run
`docker compose down` before pulling); settings moved from `./config` to a Docker
volume (`docker compose cp config/instances.json controller:/config/` once, then
`docker compose restart`); the default port is 4380 (was 8787); and the parked
library browser now lives on the `library` branch.
