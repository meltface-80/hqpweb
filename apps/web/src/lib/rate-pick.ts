// Choosing an output rate or mode: shared by Advanced and the v2 signal card, so both
// follow the same rules. Rate and mode changes can pause playback; the server checks
// that it recovers and tries to roll back if it doesn't.
import type { Change } from "./api.ts";
import type { rateItems as rateItemsOf } from "./hints.ts";

type RateItem = ReturnType<typeof rateItemsOf>[number];
type Apply = (change: Change) => Promise<unknown>;

export function applyMajor(what: string, change: Change, apply: Apply, ask: (q: string) => boolean = confirm) {
  const ok = ask(
    `Change ${what}?\n\nPlayback may pause for a few seconds. If it doesn't recover, the change is rolled back automatically.`,
  );
  if (ok) void apply(change); // apply reports its own errors in the footer
}

/**
 * A rate the current modulator can't play at goes with a modulator that can, as one change.
 * One that can't play at all (and has no fix here) isn't written: it would only stop playback.
 */
export function pickRate(r: RateItem, apply: Apply, ask: (q: string) => boolean = confirm, tell: (m: string) => void = alert) {
  if (r.companion) {
    const ok = ask(
      `${r.warn ?? "The current modulator can't play there"}.\n\nChange the output rate to ${r.name} and the modulator to ${r.companion}, together?`,
    );
    if (ok) void apply({ rate: r.rate, shaper: r.companion });
  } else if (r.cantPlay) tell(`${r.name}: ${r.warn ?? "can't play with the current settings"}.`);
  else applyMajor(`output rate to ${r.name}`, { rate: r.rate }, apply, ask);
}
