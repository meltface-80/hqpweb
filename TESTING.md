# Testing guide

Thanks for trying hqpweb. It's a beta: it works on the setups in the README's
"Tested with" table, and your setup is exactly what we can't test ourselves.

## Before you start

- **It changes real HQPlayer settings.** Every change is checked, and when one stops
  playback the app tries to put the old settings back. Still, start with the volume low.
- **Heavy filter and modulator choices can overload a machine.** The app warns, and
  tries to roll back when playback falls behind, but an overloaded HQPlayer can stop
  answering and need a restart. That's HQPlayer's limit, not a fault in your setup.
- **Restarting HQPlayer** brings back its _saved_ settings, which may be louder than
  what you set from the app. Check the volume after any restart.
- **With Roon as the source**, HQPlayer can't control Roon (only Stop is offered),
  unless you connect Roon in Settings → Roon.

## Install

Follow the [README](README.md): three commands, then add your HQPlayer in
Settings → General.

## What to try

1. **Connect:** Scan now, or add by address. Does your instance show as answering?
2. **Now playing:** while music plays, do the rate, mode and source look right, and
   does "Processing" settle on Real-time ✓ after about 30 s?
3. **Quick changes:** 1x and Nx filters, modulator or dither, volume. Does each show
   a ✓ when HQPlayer has taken it?
4. **Advanced:** mode, output rate and the toggles. Did a change apply, or roll back
   with a clear reason?
5. **Presets:** save the current settings, change something, apply the preset.
   If you have two instances, try a preset saved on one on the other.
6. **Roon** (optional): connect, approve in Roon, pick the zone. Do the track, cover
   art, slider and buttons follow Roon?
7. **Install itself:** anything in the README you had to guess at, or skip?

## Reporting

Open an issue with the "Test report" template. Your HQPlayer version and platform
matter most. Embedded, HQPlayer 6 and Windows are all untested so far.
