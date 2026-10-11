// The core's API in-process (@app/contract CoreApi): what a phone app hands its page instead
// of HTTP. Same calls, same answers, same refusals as the server's HTTP API (the contract
// tests run one suite against both). Everything crosses as JSON, as it does over HTTP, so
// the page never holds a live reference into the core's state, nor the core into the page's.
import type { CoreApi, HostApi } from "@app/contract";
import { parseSeek } from "./requests.ts";
import { parseRoonAction, parseRoonSettings, parseRoonZone, watchRoonZone } from "./roon/roon-host.ts";
import type { RoonLink } from "./roon/roon.ts";
import type { Service } from "./service.ts";
import { wireError } from "./wire-error.ts";

/** A copy as the wire would carry it: JSON in, JSON out. */
const wire = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

/** An error as the HTTP client would throw it: the server's words, with its status. */
function apiError(err: unknown): Error {
  const w = wireError(err);
  if (w.unexpected) console.error(err);
  return Object.assign(new Error(w.error), { status: w.status });
}

async function run<T>(call: () => Promise<T>): Promise<T> {
  try {
    return wire(await call());
  } catch (e) {
    throw apiError(e);
  }
}

/** With `roon`, the status stream carries its zone updates too, as the server's /events does. */
/**
 * A stream's events as the wire hands them over: never during the subscribing call (the
 * core sends Roon's current zone at once, and a page subscribing inside a Svelte effect would
 * take that as part of the effect, and loop), in order, and none after it's stopped.
 */
function stream() {
  let open = true;
  return {
    send: (deliver: () => void) => queueMicrotask(() => open && deliver()),
    stop: (off: () => void) => () => {
      open = false;
      off();
    },
  };
}

export function localApi(service: Service, { roon }: { roon?: RoonLink } = {}): CoreApi {
  return {
    instances: () => run(() => service.instances()),
    discover: () => run(() => service.discover()),
    addInstance: (body) => run(() => service.addInstance(wire(body))),
    renameInstance: (id, name) => run(() => service.renameInstance(id, { name })),
    removeInstance: (id) =>
      run(async () => {
        const r = await service.removeInstance(id);
        roon?.forgetInstance(id); // its zone too, as the server does
        return r;
      }),
    setRestartCap: (id, maxDb) => run(() => service.setRestartCap(id, { maxDb })),
    saveSetup: (id, change) => run(() => service.saveSetup(id, wire(change))),
    addDac: (id, name, currentName) => run(() => service.addDac(id, { name, ...(currentName ? { currentName } : {}) })),
    renameDac: (id, dac, name) => run(() => service.renameDac(id, dac, { name })),
    removeDac: (id, dac) => run(() => service.removeDac(id, dac)),
    selectDac: (id, dac) => run(() => service.selectDac(id, { dac })),
    capabilities: (id) => run(() => service.capabilities(id)),
    change: (id, change) => run(() => service.change(id, wire(change))),
    undo: (id) => run(() => service.undo(id)),
    transport: (id, action) => run(() => service.transport(id, { action })),
    seek: (id, seconds) => run(() => service.seek(id, { seconds })),
    dismissVolumeJump: (id) => run(() => service.dismissVolumeJump(id)),
    presets: (id) => run(() => service.presetsFor(id)),
    savePreset: (body) => run(() => service.createPreset(wire(body))),
    renamePreset: (pid, name) => run(() => service.updatePreset(pid, { name })),
    updatePresetFromCurrent: (pid, fromInstance) => run(() => service.updatePreset(pid, { fromInstance })),
    deletePreset: (pid) => run(() => service.deletePreset(pid)),
    applyPreset: (id, pid) => run(() => service.applyPreset(id, pid)),
    learned: (id) => run(() => service.learned(id)),
    history: (id) => run(() => service.history(id)),
    forgetLearned: (id) => run(() => service.forget(id)),
    forgetCombo: (id, c) =>
      run(() =>
        service.forget(id, { mode: c.mode, rateHz: c.rateHz, filter1x: c.filter1x, filterNx: c.filterNx, shaper: c.shaper }),
      ),
    // A stream: the same events the server's /events sends (a snapshot with its health, or
    // why HQPlayer can't be reached, and Roon's zone). Nothing in-process can be "lost".
    status: (id, on) => {
      const s = stream();
      const off = service.subscribe(id, (e) =>
        s.send(() => {
          if (e.snapshot) on.now(wire({ ...e.snapshot, health: e.health }) as Parameters<typeof on.now>[0]);
          else on.unreachable(e.error ?? "unreachable");
        }),
      );
      const offRoon = roon && on.roon ? watchRoonZone(roon, id, (e) => s.send(() => on.roon!(wire(e)))) : () => {};
      return s.stop(() => {
        off();
        offRoon();
      });
    },
    meter: (id, on) => {
      const s = stream();
      return s.stop(service.subscribeMeter(id, (e) => s.send(() => on(wire(e)))));
    },
  };
}

type RoonApi = Pick<
  HostApi,
  "roon" | "configureRoon" | "discoverRoon" | "setRoonZone" | "roonSeek" | "roonTransport" | "roonArtUrl"
>;

/**
 * Roon for a page in-process (the phone app): the same checks and answers as the server's
 * Roon routes. No finding the core (that's multicast; the page hides Find): its address is typed in.
 */
export function localRoonApi(roon: RoonLink, service: Service): RoonApi {
  // An unknown instance is refused first, as the server's routes do.
  const known = (id: string) => void service.instance(id);
  return {
    roon: () => run(async () => roon.view()),
    configureRoon: (body) => run(async () => roon.configure(parseRoonSettings(wire(body)))),
    discoverRoon: () => run(async () => []),
    setRoonZone: (id, zone) => run(async () => (known(id), roon.setZone(id, parseRoonZone({ zone })))),
    roonSeek: (id, seconds) => run(async () => (known(id), roon.seek(id, parseSeek({ seconds })))),
    roonTransport: (id, action) => run(async () => (known(id), roon.control(id, parseRoonAction({ action })))),
    roonArtUrl: (key, size) => roon.imageUrl(key, size) ?? "",
  };
}
