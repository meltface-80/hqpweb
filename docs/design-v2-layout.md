# The v2 layout: a one-page spec

The shape was settled over four rounds of wireframes (October 2026). This page fixes the
visual and interaction rules for building it. It sits under [design-v1.md](design-v1.md),
whose fact base (§2) still holds, and it changes no advice: the rules in
`apps/web/src/lib/advice/` and the guide's wording carry over unchanged.

The new layout ships behind a per-device switch (Settings → "Try the new layout"), off
by default, until it is better than the current one.

## Structure

- **Now card** (top): track, artist, the meter strip, progress, then play/pause and
  volume. It is the host's part: MusicD-Remote's sidebar drops it and keeps the rest.
- **Signal-path card**:
  - A path line on top: `44.1k → gauss-xla → ASDM7EC-super → DSD256 → Holo ● 2.1×`.
  - Mode tabs (DSD | PCM). Each tab holds its mode's 1x/Nx filter pair, shaping
    (modulator or dither) and rate. The inactive tab shows the settings _as last seen_
    (`capabilities.lastSeen`), dimmed and timed, with "Switch to …" (it pauses: see
    below).
  - A mode this HQPlayer doesn't offer is greyed, with (i) "set in HQPlayer itself".
  - **Guide me** at the foot of the card: the guide as a flow (canvas D2), full height,
    one step at a time with Back and Next. DSD: your DAC, amplifier, volume, then where to
    start; PCM: your DAC, the connection, then where to start. Next waits for an answer;
    reopening starts at the first question left; "Switch to PCM" carries on with the
    dither steps. The steps and words are the guides' own (`guide-flow.ts` only orders
    them). Filters aren't in it: the guide has no filter rules.
- Below the card: **Compare** and **History** as labelled buttons, then Advanced
  (the rare switches only) and Presets.
- **Compare** (canvas I5; `compare.ts`): two full cards in columns. A is what was playing
  when it opened; B is chosen per setting (mode, 1x, Nx, modulator or dither, rate), and
  a preset loads into either side. The big A and B buttons send only what differs (the
  rate always goes with a mode switch). Which side is heard is read from State, never
  from the last tap: a rollback or a change elsewhere shows as "neither". A note says what
  a switch costs (a pause across modes, a gap across rates) and that levels aren't
  matched across modes (not measured, so no volume change). Keep A, Keep B, Save B as a
  preset. Another mode's choices come from `capabilities.modeLists`; a mode never seen
  on this HQPlayer offers its last-seen settings only, and says so.
- **Mini bar**: when the now card scrolls out of view, a slim bar (title, health, play/pause,
  volume) appears at the bottom. Tapping the title returns to the now card.

## Rules

1. **Look.** Today's tokens and components (`theme.css`: `--bg`, `--bg-elev`, `--text-dim`,
   `--accent`, `--ok`, `--warn`, `--danger`, all five themes). The wireframes' colours were
   placeholders. New tokens only where none exists: `--font-mono`.
2. **Chips.** One component, five kinds (`chips.ts`, `shaper-chips.ts`). Meaning never by colour alone: each kind has a symbol or word.
   - _fact_: neutral, e.g. "7th order".
   - _good here_: `--ok` with ✓, e.g. "✓ kept up here (2.1×)".
   - _trouble here_: `--warn` with ✗, e.g. "✗ fell behind here".
   - _suggested_: `--accent-soft`, e.g. "suggested for your DAC".
   - _in use_: solid, e.g. "in use ✓".

   At most four chips on an item; more goes under its "Why?". In pickers, the chips
   double as filters, with a count of what's shown: yes/no facts are toggle chips, facts
   with several values are one drop-down each (phase, apodizing, ratio, focus, length;
   order, load, generation). In use and trouble are never filters. Load chips name the
   line they're ranked in ("EC line: heaviest"): Signalyst ranks load only within a line.

3. **Names.** HQPlayer's identifiers (filters, modulators, dithers, rates) in `--font-mono`;
   everything else in `--font-sans`.
4. **Health.** One indicator, everywhere it appears (path line, mini bar, strip): a dot
   plus a word.
   - _keeping up_ (2.1×): from `speed.ts`, unchanged.
   - _struggling_: from `speed.ts`, unchanged.
   - _not answering_.
   - _not playing_.

   The meter going quiet alone never means "stopped"; it is quiet for 3–5 s at track and
   rate changes (measured).

5. **Rate.** The row always shows what auto resolved to and why.
   - In PCM, auto is the highest rate the filter can use from this source. It is a normal
     choice, e.g. "Auto → 705.6 kHz (sinc-M needs a power-of-two step)".
   - In DSD, auto is always the maximum. It is flagged when the shaping is heavy there or
     has failed here, with the fixed rates offered.
6. **Mode switch.** Always the pause sequence (change-engine.ts).
   - The confirm sheet says what happens and that it pauses about 5 s.
   - With Roon linked it carries on by itself. Without, it stays paused and says
     "press play in Roon".
7. **Layout width.** Two columns from 900 px: the card on the left, the now panel (with
   the meter) on the right, and no mini bar. One column below that.
8. **Sheets.** The picker, Compare and History are full-height sheets with Done on phones,
   and side panels over the card on wide screens. Back returns to where you were.
9. **Meter.** The strip shows a labelled "Meter" control with an expand icon.
   - Opening it pushes content down; the controls stay where they are, above it.
   - Views: Bars, Line (peak hold), Levels, Waterfall (changes marked), and later
     Stereo.
   - The Levels view also works small. Without a meter stream, the strip shows
     status-based health only, and says so.
10. **Motion.** Only the meter opening and the mini bar arriving. None with
    `prefers-reduced-motion`.
11. **Things that go wrong.** One card at the top of the list, never a pop-up:
    - rolled back;
    - not answering, with the louder-relaunch guard;
    - can't reach its output, with steps.

    Each card says what happened and gives one next step.

12. **First launch.** No questions. At most a one-time, dismissible tip that the guide exists.
13. **Words.** All user-facing text in one module. The guide's existing strings are reused
    verbatim, except where they point at a place: in this layout rate and mode are on the
    card, not under Advanced (`guide-flow.ts` PLACES). New strings follow "honest and
    terse" (rollback "tries to"; no jargon).
    Compare uses "kept up here", never "plays here".

## Component states

Each new component handles all of these:

- loading;
- HQPlayer not answering;
- nothing playing;
- no meter stream;
- last-seen missing or stale;
- Roon not linked;
- a mode this HQPlayer doesn't offer;
- a narrow width (320 px, MusicD's sidebar).

## Data

All of it already exists on the server:

- `capabilities.keptUp`, `knownBad` (with `sourceRates`) and `lastSeen`;
- `capabilities.modeLists`: each mode's filters, shapers and rates as last read on this
  engine, by name, so Compare can offer the other mode's choices before switching;
- `GET /api/instances/:id/history`;
- the SSE `now` and `roon` events.

Filters have no CPU-load data. Their load chip is only ever the per-machine "kept up
here".
