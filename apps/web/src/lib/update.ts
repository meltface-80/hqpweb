// A newer hqpweb on the server (moved from App.svelte; tested in update.test.ts).

/**
 * An installed app (PWA) can stay open for days on old code. A built page knows the commit
 * it was built from; when the server reports a different one, offer a reload. Development
 * servers bake the commit in at start, so they never offer one.
 */
export const offerReload = (built: string, served: string | undefined, dev: boolean) =>
  !dev && !!built && !!served && served !== built;
