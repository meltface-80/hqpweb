# Changelog

Versions follow [semantic versioning](https://semver.org). Before 1.0, any release
may change behaviour; upgrade notes say what you need to do.

## Unreleased

## 0.1.0-beta.3 — a guide for the modulator and dither

**Update:** `docker compose pull && docker compose up -d`. Settings are kept; the
setup answers start empty, and failures hqpweb learned before are kept (counted as once).

### Added

- **A guide for the modulator and dither (beta).** The Modulator / Dither row now opens
  a sheet with two tabs. **List** is HQPlayer's whole list, grouped by family, with the
  older series folded (the one in use always shows). **Guide** asks a few questions
  about your DAC, amplifier, volume and connection, and suggests where to start, with
  each suggestion linked to the Signalyst post it comes from. Suggestions are starting
  points, chosen by name from your HQPlayer's own list. Nothing is changed until you pick.
  - **Rate and modulator together:** the guide offers pairs (for example DSD256 with
    ASDM7EC-fast, or DSD1024 with AHM), each set as one change. hqpweb orders the two
    so playback never passes through a pair that can't play.
  - **What each modulator is like:** CPU load and character for the EC variants and AHM,
    with the post each comes from.
  - The List keeps search and an **Only what plays here** chip.
- **Safety net for rate and modulator.** Picking a rate your modulator can't play at
  (in Advanced), or a modulator your rate can't take (AHM below DSD1024), offers the
  other half of a pair that plays. That's the only change hqpweb refuses on its own.
- **When HQPlayer struggles:** at DSD1024, modulators other than AHM carry Signalyst's
  note that they need a high-clock CPU; the "falling behind" warning waits until it
  lasts, and names a recent change; and if HQPlayer stops answering, hqpweb says how to
  restart it (Desktop or Embedded), and dims what it last showed.
- **Failure history.** hqpweb counts how often a combination has failed on each
  HQPlayer ("failed here 3×, last 6 Oct"), and you can clear it in Settings.
- **Settings → Your setup**, where the same answers can be seen and changed, per
  instance, with **Find your DAC**: a table of chips and common models.

### Changed

- **Rollbacks after a rate or mode change wait longer** before judging playback, so the
  few slow seconds while HQPlayer restarts its processing aren't taken for an overload.
  A real overload is still caught within about 11 seconds. The rollback message says
  what happened in plainer words, and shows in the picker if it's open.

- The DAC table follows Signalyst's 2025–26 advice: newer ESS chips are listed as
  re-processing DSD, and Denafrips as converting it (PCM output suits it better).
- **Volume:** the guide suggests Signalyst's gain optimisation (HQPlayer at −3 dB, the
  amplifier at the loudest you'd ever want, then turn down in HQPlayer or Roon). The
  512+fs modulators are offered as an option at DSD512 and up, not as the starting point.
- In the list, a row the guide suggests for your answers shows the guide's reason
  instead of an older, narrower note (for example, NS9 at 384 kHz for a ladder DAC).

- Section headings in Settings, and the rating groups in the filter picker, are now in
  the main text colour and bold, so they read as headings.

## 0.1.0-beta.2 — safer rollback, Restart playback

**Update:** `docker compose pull && docker compose up -d`. Settings are kept.

### Changed

- **A rollback never raises the volume.** If a change that also lowered the volume
  (a preset, say) stops playback and is rolled back, the other settings go back but
  the volume stays where you put it. Undo, which you press yourself, can still return
  to the level you were at, if nobody moved it since.
- **When a rollback leaves HQPlayer stopped,** hqpweb says so and offers **Restart
  playback** (if HQPlayer was playing from its own playlist), or tells you to resume in
  Roon. It no longer says HQPlayer "may need a restart". Restarting HQPlayer is the
  fallback if playback still won't come back; check its volume afterwards.

### Fixed

- In PCM mode, results named the dither "Modulator"; they now say "Dither", as the
  picker does.

### For developers

- Browser tests (`npm run test:e2e`), a curated ESLint set, a file-length limit,
  volume-safety property tests, a pre-commit hook, and a live release check against a
  real HQPlayer (`npm run release-check`). See `docs/quality-plan.md`.

## 0.1.0-beta.1 — first beta, and a published image

Beta: the feature set is settled for now, and updates keep your settings (instances,
presets, learned failures). Bugs and rough edges are still expected.

**Update:** `docker compose pull && docker compose up -d`. Settings are kept.

### Upgrade notes

- **The compose file now runs the published image** (`ghcr.io/statelycurmudgeon/hqpweb`,
  amd64 and arm64) instead of building. If you installed from a clone and want to keep
  building from source, use
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.
  Either way the settings volume is the same.

### Added

- **Published image** for each release, with build provenance; `HQPWEB_TAG` pins a
  version.
- **Discovery tries harder:** each scan sends its query three times, so a lost UDP
  packet no longer means "nothing found" (a tester's first scans failed several times).
- **Settings carry a format number,** and CI loads a set of settings files as
  earlier versions wrote them, so an update can't silently drop your instances,
  presets, learned failures or Roon pairing. A file from a newer hqpweb loads with a
  warning.
- **README screenshots.**

### Fixed

- "Apod 23· your filter handles this" now has its space.

## 0.1.0-alpha.2 — filter guide, compatible filters, safety signals

**Update:** `git pull && docker compose up -d --build`. No settings change.

- **Apodization notice.** When HQPlayer's Apod counter passes 10 in a track and the
  filter in use isn't apodizing, the Now card says so, with "Choose an apodizing
  filter…". With an apodizing filter, the count shows "your filter handles this".
  (The counter is per track: seen past 150 on one track, then 5 on the next.)
- **"hqpweb has been updated. Reload."** An installed app can stay open on old code;
  it now checks the server when it comes back to the foreground and offers a reload.
- **Health and About show the build's commit**, so deploys can be told apart.
- **Filter and modulator descriptions (HQPlayer 6):** each filter shows HQPlayer's
  own rating (stars); tap ⓘ for what it favours (transients, timbre, space) and the
  ratios it works with. Chips narrow the list (5/5, a focus, "works here"), and
  Settings can group the list by rating. Modulators show their generation (Gen1–8).
- **Ratio warnings use HQPlayer 6's own rule** when it gives one. On v5 we follow
  the v5 manual, except where measured otherwise: on Desktop 5.17.2 sinc-M needs a
  power-of-two ratio (it refuses 3×, and 2× down plays), not "whole-number". FFT
  allows power-of-two either way, and the ext2 variants are covered.
- **v5 instances get the same guide:** ratings and focus borrowed from HQPlayer 6 by
  name; v5-only filters and modulators described from the v5 manual.
- **Compatible filters first.** When the output rate is fixed, filters that can't do
  the current conversion ratio are hidden by a "compatible" chip (on by default; "Show
  all" lists them struck through). Picking one offers the output rates that fit, marks
  the closest, offers Auto, or applies anyway; the filter and rate change together.
- **"The next track won't start."** When HQPlayer is stopped and the track queued in
  its playlist can't play with the current filter and fixed rate, the Now card says
  why, with a fix: rates that fit, Auto, or another filter. (HQPlayer itself just
  ignores Play.) With a fixed rate, a note under the filters also warns about source
  rates the next album might use.
- **Volume jumps are flagged.** If HQPlayer's volume rises 10 dB or more without
  hqpweb (a restart brings it back at its saved level; v6 at −3 dB, measured), the Now
  card says so, with a button to go back to the previous level, and Dismiss.
- **"HQPlayer didn't start."** HQPlayer replies OK to Play even when nothing can start.
  After a Play from hqpweb, if nothing starts within a few seconds, the app says so,
  and why when a rule explains it; otherwise it points at the output (an NAA in use
  elsewhere, a DAC that's off).
- **Apod and clip counters.** HQPlayer's apodization counter appears once it's above
  0 (amber; red past 10, where HQPlayer's manual suggests an apodizing filter, with a
  link that opens the filter list narrowed to apodizing filters). The clip counter
  appears once above 0, with a hint to lower the volume. Filters carry an "apodizing"
  chip, from HQPlayer 6's own filter table (yes, no or partly).
- **"Processing" shows HQPlayer's processing speed** (e.g. 32×) on 5.17.2 and 6.x.
- **Seek** within files HQPlayer plays itself.

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
