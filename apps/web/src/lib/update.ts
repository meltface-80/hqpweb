// A newer hqpweb on the server (moved from App.svelte; tested in update.test.ts).

/**
 * An installed app (PWA) can stay open for days on old code. A built page knows the commit
 * it was built from; when the server reports a different one, offer a reload. Development
 * servers bake the commit in at start, so they never offer one.
 */
export const offerReload = (built: string, served: string | undefined, dev: boolean) =>
  !dev && !!built && !!served && served !== built;

/**
 * When the page comes back to the foreground, and every 10 minutes, ask the server which
 * commit it runs; call `onNewer` once it differs. Returns the cleanup for an $effect.
 */
export function watchForUpdate(built: string, dev: boolean, health: () => Promise<{ commit?: string }>, onNewer: () => void) {
  let done = false;
  const check = async () => {
    if (dev || !built || done) return; // no request when it couldn't matter
    const h = await health().catch(() => null);
    if (offerReload(built, h?.commit, dev)) {
      done = true;
      onNewer();
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };
  document.addEventListener("visibilitychange", onVisible);
  const t = setInterval(() => void check(), 10 * 60_000);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(t);
  };
}
