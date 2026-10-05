# Live release checklist

Before every release tag, run this against a real HQPlayer. It checks what no fake
can: that changes take effect, that a rollback recovers playback, and that the
explanations appear (quality plan, step 2). It follows [CLAUDE.md](../CLAUDE.md) rule 3:
the instance's owner says OK first; the check snapshots the settings, changes them,
verifies playback, restores them and compares. The volume is only ever lowered.

## What you need

- An HQPlayer **in PCM mode, stopped**, at **−20 dB or lower**, with nobody listening.
  It needs the `poly-sinc-short-mp` and `sinc-M` filters and 176.4 and 192 kHz output
  rates (v5 PCM lists have them).
- A **quiet 44.1 kHz test file on HQPlayer's machine**: for example 10 minutes of noise
  at −60 dBFS. HQPlayer plays it from its own playlist, so no Roon is needed.

## Run it

```sh
# Dry run: reads only, and prints exactly what it would change.
HQPWEB_CHECK_HOST=192.0.2.10 HQPWEB_CHECK_FILE=/path/on/that/machine/noise-44k1.wav npm run release-check

# The check itself, with the owner's OK. About a minute.
HQPWEB_CHECK_HOST=192.0.2.10 HQPWEB_CHECK_FILE=/path/on/that/machine/noise-44k1.wav npm run release-check -- --write
```

It refuses to start if HQPlayer is playing, the volume is above −20 dB, the mode isn't
PCM, or a filter or rate it needs is missing. Keep your own host and file path in a
git-ignored `*.local.md`, never in the repo.

## What it does

Changes go through the real hqpweb server, started by the script; every result is
checked by reading HQPlayer directly.

1. Lowers the volume 1 dB.
2. Sets HQPlayer's playlist aside (put back at the end) and plays the test file:
   expects 44.1 kHz playing.
3. Changes the 1x filter: expects ✓ and playback OK.
4. Undoes it: expects the original filter back.
5. Sets 176.4 kHz with `sinc-M` (a 4× ratio): expects playback OK.
6. Asks for 192 kHz (4.35×, which `sinc-M` can't do) and 1 dB lower volume: expects
   HQPlayer to stop, hqpweb to roll the rate back and explain why, and the volume to stay
   low. Playback must then recover: by itself (Roon), or with what hqpweb's **Restart
   playback** button presses (Stop, then Play), judged by the position really moving.
7. Stops, restores every setting except the volume, puts the playlist back, and
   compares with the snapshot.

The volume ends 2 dB below where it started; raise it yourself afterwards. HQPlayer's
own Play button is left on its playlist (adding the test file selects it); Roon still
plays to it (measured). Roon's own playlist entries (its stream) aren't put back; Roon
doesn't need them. If step 6 fails, the check prints HQPlayer's state
through the rollback.

## Also check by hand

On a phone, open hqpweb against the instance while the test file plays: the Now card
shows 44.1 kHz in and the output rate, and Processing settles on a real-time figure.

## Results

| Date       | hqpweb         | HQPlayer               | Result                                                                                                                                                                                                 |
| ---------- | -------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-04 | main after #23 | Desktop 5.35.10, Linux | 11 of 12. **Playback didn't recover after the rollback**; the fake resumed by itself, so no test caught it. Measuring it (design §2.3) led to Restart playback. Step 6c as now written hasn't run yet. |
