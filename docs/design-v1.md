# HQPlayer Web Controller — v1 design

A small, modern web controller for Signalyst HQPlayer: pick an instance, see what
it is doing, change the settings that matter, and apply your own presets — from a
phone, tablet or desktop browser.

Status: design, pre-code. Everything under "Measured" was observed against real
HQPlayer instances on 2026-10-02; everything else is labelled as inference or as a
decision still to make.

---

## 1. Goals and non-goals

**v1 goals**

- Discover HQPlayer instances on the network, and accept manually configured ones.
- Show live status: playing state, mode, output rate, active filter, modulator/dither, volume.
- **Quick changes**, one tap, applied during playback: filters, modulator/dither,
  polarity, junk/20 kHz filter, adaptive volume, volume.
- **Major changes**, deliberately less prominent: mode (PCM / SDM / source) and output rate.
- **App-owned presets**: a named bundle of settings, applied in one action, each
  labelled as a *quick apply* or a *major apply*.
- Installable as a PWA; works on iOS Safari without an App Store build.

**Non-goals for v1**

- Playback, library and playlist control. Roon, or whatever else is driving the
  instance, owns transport.
- Loading HQPlayer's built-in configurations (blocked, see §2.4).
- Convolution and matrix editing. Toggling is cheap to add later; editing is not v1.
- Any login of its own. v1 assumes a trusted network (see §7).

**Later (v2+)**

- **Filter audition:** step through a list of filters every N seconds during
  playback, and stop on the one you like.
- Convolution / matrix profile selection, where the instance has them configured.
- Learned compatibility hints (§4.4) shared across instances.
- HQPlayer Embedded profile switching via its own web interface (§2.4).
- **Per-instance limits:** a profile of what this machine can sustain. Some filter,
  modulator and rate combinations overload a given CPU or GPU, so they could be
  marked off-limits per instance and rate. This must not be prescriptive, and
  should ideally be learned. `Status` exposes `process_speed`, `output_fill` and
  `input_fill` (measured: present in replies), which may show when an instance
  can't keep up. That's inference, not yet tested.
- **Now-playing (track, artist, album art).** HQPlayer can't supply it when Roon
  drives it: Roon sends a raw stream, and `Status` metadata says only `song="Roon"`
  with sample rate and bit depth (measured on both instances). It would need the
  Roon extension API, mapping a Roon zone to an HQPlayer instance. That's an
  optional adapter, kept outside the protocol layer. When HQPlayer plays its own
  library, its metadata may carry tags (unverified).

---

## 2. Fact base

### 2.1 The control protocol

- **Transport:** XML over raw TCP on **port 4321**. It is not HTTP. Each request is one
  XML document, and each reply is one newline-terminated XML document.
- **Discovery:** UDP multicast to `239.192.0.199` (IPv6 `ff08::c7`) on port 4321, with
  the body `<discover>hqplayer</discover>`. Each instance replies with its name and
  version. **Multicast does not cross VLANs or routed subnets**, so manual instance
  entry is a first-class path, not a fallback.
- **Official reference:** Signalyst publishes the control client source, the
  "HQPlayer SDK" (`hqp-control`), under the **MIT licence**. It is the only official
  specification. Good third-party write-ups exist (§8).
- **Setters take list indices, not IDs or names.** The filter, modulator/dither and
  rate lists **depend on the current mode**, and on the engine version.
  - **Measured, SDM mode:** 77 filters, 36 modulators, rates DSD64–DSD1024 plus auto.
  - **Measured, PCM mode:** 67 filters, 10 dithers, rates 44.1 kHz–1.536 MHz plus auto.
- **Do not trust a `result="OK"` reply.**
  - Some commands reply without a `result` attribute at all: `Set20kFilter` and
    `SetAdaptiveVolume`, measured.
  - Unknown commands reply `result="Error">Unknown command`.
  - A no-op can still say OK (convolution with no filters configured, measured).
  - A change that breaks playback can still say OK (invalid rate/modulator
    combination, measured).
  - **Always read `State` back after a change.**
- **`State` versus `Status`:**
  - `State` returns the configured settings as list indices: `mode`, `rate`,
    `filter1x`, `filterNx`, `shaper`, `volume`, `invert`, `filter_20k`, `adaptive`,
    `convolution`, `matrix_profile`.
  - `State` also has a field named `filter`. It is the filter **currently in use**,
    not a setting.
  - `Status` returns names and live values: `active_mode`, `active_rate`,
    `active_filter`, `active_shaper`, `state`, `position`, `volume`.
- **Playback `state` values:** 0 stopped, 1 paused, 2 playing, 3 stop requested.
- **Volume is a float in dB.** The usable range comes from `VolumeRange` (measured:
  −60 to −3). **Never parse it as an integer.** A third-party client that did so got
  0 dB, which is full output.
- **Socket:** an idle socket is closed after about 156 s. One connection per request
  is simple and was used for every measurement below.

**Measured later on 2026-10-02 (read-only, both instances):**

- **Volume formatting differs by platform:** macOS prints `-22`, Linux prints
  `-28.00000000000000000`.
- **`VolumeRange.max` differs too:** −3 on the Mac, 0 on Linux. Read it; never
  assume it.
- **`State.mode` is an index into `GetModes`.** `State.active_mode` is the mode's
  *value* (−1 source, 0 PCM, 1 SDM).
- **The same filter name has different indices across modes and instances:**
  `poly-sinc-gauss-hires-lp` is 51 in SDM on the Mac and 40 in PCM on Linux.
- **The `arg` attribute on `FiltersItem` is not a 1x/Nx flag.** The Mac's active 1x
  and Nx filters both have `arg="1"`. Its meaning is unknown.
- **The filter in use follows the source rate:** a 44.1 kHz source uses the 1x
  filter, a 96 kHz source the Nx filter. `Status` carries the source rate in a
  `<metadata samplerate=…>` child, alongside the stream URI.
- **The PCM rate list depends on the instance:** 13 entries up to 1.536 MHz on the
  Mac, 9 up to 384 kHz on Linux. It probably depends on the output device.
- **`ConfigurationList` with no saved configurations** returns
  `result="Error">path doesn't exist`.
- **v5 answers `GetJunkFilters` with `Unknown command`,** as expected (§2.5).
- **Discovery reply:** `<discover name="…" result="OK" version="Signalyst HQPlayer
  Desktop 5">hqplayer</discover>`, sent from the instance's own address.

### 2.2 Coexistence with Roon (or another controller)

**Measured:** read-only queries (`GetInfo`, `Status`, `State`, list enumeration) during
Roon playback had no effect on playback. Every change below was also made while Roon
was playing; Roon kept the zone throughout.

### 2.3 Live change behaviour (measured)

Measured on HQPlayer Desktop 5.32.5 on macOS, in SDM mode at DSD1024, with Roon
playing. Every change was restored afterwards and diffed against a snapshot.

| Change | Result during playback |
|---|---|
| Nx filter, 1x filter | Brief pause (≤ ~1 s), playback continues. The first call blocked ~5 s while the filter was prepared. |
| Modulator / dither | Brief pause, continues |
| Polarity invert, 20 kHz filter, adaptive volume | Brief pause or none, continues |
| Volume | Continues |
| Mode SDM → PCM, SDM → source | ~3 s, playback continues. The lists change completely. Each mode keeps its own remembered filter and dither. |
| Rate, **valid combination** (DSD512 + ASDM7EC) | Continues |
| Rate, **invalid combination** (DSD256 or DSD512 with AHM7EC8B) | Reply is OK, then HQPlayer **stops and cannot be restarted**: not by the controlling app's play, nor by HQPlayer's own `Play`, nor by stop-change-play. Setting the rate back resumes playback by itself. |
| Convolution on, with no filters configured | Reply is OK, nothing changes |
| `ConfigurationLoad` (built-in presets) | `result="Error">missing data or not authorized` |

**Consequence:** no change *requires* a manual restart. What a "major" change needs is
**verification and automatic rollback**, because some combinations are accepted and
then cannot play.

### 2.4 Built-in configurations (HQPlayer's own presets)

- `ConfigurationList` works without authentication and returns the names.
- `ConfigurationLoad` requires a `SessionAuthentication` handshake (ECDH P-256 plus
  ChaCha20-Poly1305). The client key it accepts ships only in Signalyst's closed
  Client.
- The handshake was refused on Desktop 5.32.5 (measured) and on Embedded 6.0.4
  (reported by HQPTuner).
- **We do not try to work around this.** Extracting keys from the closed Client would
  breach its EULA and isn't worth it.
- HQPlayer **Embedded** exposes profile loading through its own web interface (port
  8088, Digest auth). That restarts the daemon, for about 3–4 s. It is an optional
  later adapter, and Embedded-only.

This is why v1 uses app-owned presets (§4.3).

**Embedded uses the same control protocol.** This is *reported*, not measured: we
have no Embedded instance.

- **Same commands.** HQPTuner drives Embedded (hqplayerd 6.0.4) with the same
  XML-over-TCP commands on port 4321, with no authentication. Signalyst ships one
  control SDK for both products.
- **Reported quirks:**
  - `Volume` returns an error when volume control is disabled.
  - `SetRate` is silently ignored in `[source]` mode.
  - A mode switch clears the rate setting (the fake server models this).
- **Embedded-only extras:** the web UI on port 8088 (Digest auth) and a metering
  stream on port 4322. These are not part of the control protocol.
- **To verify:** run `tools/probe/hqp.py` against an Embedded instance before
  claiming support.

### 2.5 HQPlayer 6 versus 5

From the 6.0.1 SDK source and the release notes:

- **Nothing was removed.** Every v5 command and XML element is still present.
- **Added:** `GetJunkFilters` / `SetJunkFilter` (the "junk" filter generalises the 20 kHz
  filter), `LibraryGetHash`, `SetTransportPath`.
- **6.1.0** added the AHMxEC4B modulators, and "modulator generation information" for
  control apps.
- **Version numbering:** `GetInfo.version` is the major version only. `engine` is the
  real engine version.
- **Inference, untested:** a v5-era client drives a v6 server for everything v5 had.
  We must detect v6-only commands rather than assume them.

**Design rule:** everything enumerable is discovered at runtime and cached per
`(instance, engine version, mode)`. Nothing is hard-coded except the command names.

---

## 3. Architecture

```
 phone / tablet / desktop browser (PWA)
              │  HTTPS + JSON (REST) + server-sent events
              ▼
 ┌──────────── backend container ────────────┐
 │ instance registry (discovery + static)    │
 │ HQP client: XML-over-TCP, per instance    │
 │ capability cache (instance, engine, mode) │
 │ change engine: classify → apply →         │
 │   verify → rollback                       │
 │ preset store (JSON file on a volume)      │
 └───────────────────────────────────────────┘
              │  TCP 4321 (+ UDP multicast discovery)
              ▼
     HQPlayer Desktop / Embedded instances
```

- **A backend is mandatory.** Browsers cannot open raw TCP sockets.
- **Container networking:** use host networking where multicast discovery is wanted.
  Otherwise, configure static instances.
- **Status:** poll `Status` every 1–2 s while a client is viewing, pushed to the
  browser over server-sent events. `Status` subscription only pushes during playback,
  so polling is simpler and covers idle too.
- **Storage:** presets, static instances and learned compatibility live in one JSON
  file on a volume. No database in v1.
- **Stack:** **TypeScript end to end** (decided 2026-10-02; details in
  [development.md](development.md)):
  a Node 24 backend (`node:http`, no framework) and a small Svelte 5 PWA, in one
  container, matching the shape of other self-hosted Roon-adjacent tools. The
  protocol layer is a self-contained module with no web dependencies, so it can later
  back a CLI or a Home Assistant integration.

---

## 4. Domain model

### 4.1 Instances and capabilities

- **Instance:** name, host, port, source (discovered or static), and last `GetInfo`
  (product, platform, version, engine).
- **Capabilities:** for each mode, the lists of filters, shapers and rates. Filters
  carry an `arg` attribute whose meaning is unknown; it is *not* a 1x/Nx flag (§2.1).
  - Re-enumerate when `engine` changes or after a mode change.
  - **Version drift:** when the engine changes, diff the old and new lists and show
    "new filters/modulators available".

### 4.2 Change classes

| Class | Settings | Engine behaviour |
|---|---|---|
| **Quick** | Nx/1x filter, modulator/dither, invert, junk/20k filter, adaptive volume, volume | Apply, then read back |
| **Major** | Mode, output rate | Apply, then confirm playback survived (if it was playing). **Auto-rollback** after ~5 s of no progress, with a clear message ("DSD512 isn't supported with AHM7EC8B on this instance"). |

The UI shows quick controls up front and puts major controls behind an "Advanced"
section.

### 4.3 App-owned presets

- **A preset stores names, never indices:**
  `{mode: "SDM (DSD)", rate: 22579200, filterNx: "poly-sinc-gauss-hires-lp",
  filter1x: "poly-sinc-gauss-xla", shaper: "ASDM7EC", invert?, junk?, adaptive?,
  volume?}`.
  - Every field is optional. A preset can be just "this filter".
  - Volume is only included if the user explicitly saves it.
  - Applying a preset **never raises volume** unless it was saved with volume.
- **Apply order:**
  1. mode (then re-enumerate)
  2. rate
  3. filters
  4. shaper
  5. toggles
  6. volume

  Resolve names to indices against the instance's current lists at apply time.
- **Classification is automatic:** the preset is diffed against the current `State`.
  If mode or rate would change it's a *major apply*, otherwise a *quick apply*. The
  UI shows which one before the tap.
- **Unresolvable names** (a filter missing in this engine version, or on this
  instance) are reported per field. The rest still applies, unless the user chose
  "all or nothing".
- **Snapshot and undo:** take a `State` snapshot before every apply, so "undo last
  change" is always one tap.

### 4.4 Compatibility learning

When a major change is rolled back, record `(instance, engine, mode, rate, shaper) →
failed`. The pickers then grey out or warn on known-bad combinations.

**Inference, not yet verified:** the names suggest constraints, such as "512+fs"
modulators needing ≥ DSD512, and AHM…8B possibly being DSD1024-only. v1 should learn
these combinations, not hard-code them.

---

## 5. UI sketch

1. **Instance picker:** discovered and static instances, with online status, product
   and engine version.
2. **Now card:** state, mode, output rate (shown as "DSD512", "768 kHz" and so on),
   active filter, modulator/dither, volume. Updated live.
3. **Quick controls:** filter (Nx and 1x), modulator/dither, volume slider, toggles.
   Searchable pickers, because the lists hold 36–77 items.
4. **Presets:** one-tap apply, each with a quick or major badge; "save current as
   preset"; edit and delete.
5. **Advanced:** mode and rate, with the verify-and-rollback behaviour visible
   ("applying… playing ✓" or "rolled back: …").
6. **Undo last change.**

---

## 6. Testing

- **Protocol unit tests** against recorded replies, including reply shapes without a
  `result` attribute, `Unknown command` and `not authorized`.
- **A live integration harness**, opt-in and pointed at a real instance:
  1. snapshot `State`;
  2. run each change class;
  3. measure stall and playback state;
  4. restore;
  5. diff against the snapshot.

  It must refuse to start unless playback is in a known state. Volume may only ever
  go down during tests.
- **A fake HQPlayer server** (a small TCP responder) for CI and UI development.

---

## 7. Security model (v1)

- HQPlayer's settings commands are unauthenticated. Anyone who can reach port 4321
  can already do everything this app does.
- The app adds no capability and no login; it relies on network placement. Deploy it
  on a trusted network, or behind a reverse proxy with authentication, never exposed
  publicly.
- Volume handling is the one safety-critical path. Use float parsing, clamp to the
  `VolumeRange` maximum, and never raise volume implicitly.

---

## 8. Licensing, naming and prior art

- **Licence: MIT.**
  - The official control-API source is MIT (© Jussi Laako), with no patent,
    trademark or anti-reverse-engineering clauses.
  - Signalyst describes the control API as usable "for implementing a custom GUI or
    other type of front-end".
  - On third-party controllers, Signalyst's author has said "it is not up to me, it is
    up to respective developers."
  - Implementing the published protocol is fine. Reverse engineering the closed
    Client is not, and we don't need to.
- **Name:** "HQPlayer" is used descriptively, as in existing MIT projects (HQPTuner,
  LMS-HQPlayer-Bridge). The README must carry a non-affiliation notice: *"Not
  affiliated with, endorsed by, or supported by Signalyst. HQPlayer is a trademark of
  its owner, used here only to identify compatible software."* Do not use Signalyst
  logos. Trademark registrations were not checked.
- **Prior art:**
  - HQPTuner (MIT, Embedded-focused; excellent protocol notes)
  - unified-hifi-control (multi-source bridge, noncommercial licence)
  - LMS-HQPlayer-Bridge (bundles the 6.0.1 SDK source)
  - HQPDcontrol (Android)
  - Signalyst's HQPlayer Client (closed source, free on iOS)

  None is a simple, modern, Desktop-friendly web controller.

**References**

- github.com/ohshitgorillas/hqptuner, `docs/protocol.md`
- github.com/SimonArnold002/LMS-HQPlayer-Bridge, `hqp-control-601-src/` (MIT SDK source)
- github.com/open-horizon-labs/unified-hifi-control, `docs/hqplayer-protocol-reference.md`
- signalyst.com/downloads (SDK), signalyst.com/category/desktop (release notes)
- help.roonlabs.com — HQPlayer article

---

## 9. Open decisions

1. ~~**Stack**~~ — decided: TypeScript end to end (Node 24, `node:http`, Svelte 5 PWA).
2. **Presets:** keep them per instance, or global and resolved by name per instance
   (proposed: global, with per-instance resolution warnings).
3. **Embedded profile adapter** (port 8088): v1.x or later.
4. **Filter audition:** v2, but the change engine should expose
   "apply quick change N times" cleanly so it can be added without rework.
