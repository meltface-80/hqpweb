# Testing guide

Thanks for trying this out. It's pre-alpha: the core works on the setups below, and
your setup is exactly what we can't test ourselves.

## Before you start

- **It changes real HQPlayer settings.** Every change is checked, and changes that
  stop playback are rolled back automatically. Still, start with the volume low.
- **Heavy filter and modulator choices can overload a machine.** The app warns, and
  rolls back when playback falls behind, but an overloaded HQPlayer can stop
  answering and need a restart. That's HQPlayer's limit, not a fault in your setup.
- **With Roon as the source, use Roon for play/pause/next.** A pause sent through
  HQPlayer reaches Roon, but play and next don't, so the app disables those buttons
  while Roon is playing.

## Install

Follow the [README](README.md): three commands, then add your HQPlayer in
Settings → Instances.

## What to try

1. **Connect:** Scan now, or add by address. Does your instance show as answering,
   with the right engine version?
2. **Now playing:** while music plays, do the rate, mode, source and filter look
   right?
3. **Quick changes:** filter (1x and Nx), modulator or dither, volume, the toggles.
   Does each one show a ✓ when HQPlayer has taken it?
4. **Advanced:** mode and output rate. Did it switch, or roll back with a clear
   reason?
5. **Presets:** save the current settings, change something, apply the preset.
   Try a preset saved on one instance on another, if you have two.
6. **Library** (if HQPlayer has its own library scanned): browse, and play an
   album. This path is the least tested.
7. **Install itself:** anything in the README you had to guess at, or skip?

## Reporting

Open an issue using the "Test report" template. Your HQPlayer version and platform
matter most. Embedded, HQPlayer 6 and Windows are all untested so far.
