// What to tell the listener when HQPlayer stops answering, typically after a change it
// couldn't keep up with (design §2.3: overload builds over minutes, and the control API
// stops answering, so neither rollback nor undo can reach it). Restarting is the cure.
// Embedded: Signalyst's own command for Linux installs (Jussi Laako, Roon forum
// t/244327/1650, Jun 2025); HQPlayer OS documents none, so the machine is the fallback.

export interface RestartSteps {
  steps: string[];
  /** What to check once it's back. */
  after: string;
}

const DESKTOP = "Quit HQPlayer and open it again (Force Quit on a Mac, or End task on Windows, if it won't quit).";
const EMBEDDED = [
  "On the HQPlayer machine, run: sudo systemctl restart hqplayerd",
  "On HQPlayer OS, or if that doesn't work, restart the HQPlayer machine.",
];

export function restartSteps(product: string | undefined): RestartSteps {
  const p = product ?? "";
  const steps = /Embedded/i.test(p)
    ? EMBEDDED
    : /Desktop/i.test(p)
      ? [DESKTOP]
      : [`Desktop: ${DESKTOP}`, ...EMBEDDED.map((s) => `Embedded: ${s}`)];
  return {
    steps,
    after:
      "HQPlayer comes back on its saved settings, which may not be the last ones you chose: check the volume before playing.",
  };
}

/**
 * Overload can build over minutes after a change (design §2.3: about 5 minutes to 100%
 * CPU, measured), well after hqpweb's playback check ends. Within this window, the
 * overload banners name the last risky change, next to Undo.
 */
export const RECENT_MS = 10 * 60_000;
export const recentChange = (changedAt: number | null, now: number) => changedAt !== null && now - changedAt <= RECENT_MS;
