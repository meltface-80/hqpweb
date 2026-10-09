// What an e2e flow file declares: one fake HQPlayer per instance id, with its setup
// (stack.ts starts them). Helpers set a fake's state by name, as indices depend on the mode.
import type { FakeHqp, FakeOptions, ProfileId } from "@app/fake-hqp";

/** Set a fake's filter for one slot, by name (indices depend on the mode). */
export function setFilter(fake: FakeHqp, slot: "filter1x" | "filterNx", name: string) {
  const f = fake.lists.filters.find((x) => x.name === name);
  if (!f) throw new Error(`no filter ${name} in ${fake.profile.id}`);
  fake.rem[slot] = f.index;
}
/** Set the modulator or dither, by name. */
export function setShaper(fake: FakeHqp, name: string) {
  const s = fake.lists.shapers.find((x) => x.name === name);
  if (!s) throw new Error(`no shaper ${name} in ${fake.profile.id}`);
  fake.rem.shaper = s.index;
}
/** Fix the output rate (0 = auto), by Hz. */
export function setRate(fake: FakeHqp, hz: number) {
  const i = fake.lists.rates.indexOf(hz);
  if (i < 0) throw new Error(`no rate ${hz} in ${fake.profile.id}`);
  fake.rateIndex = i;
}

export interface Flow {
  name: string;
  profile: ProfileId;
  setup?: (fake: FakeHqp) => void;
  /** Simulated machine speed (1 = real time), e.g. a filter this machine can't keep up with. */
  speed?: FakeOptions["speed"];
  /** A fake meter stream beside it (the fake's meter.ts); without one, nothing listens there. */
  meter?: boolean;
}

export type Flows = Record<string, Flow>;
