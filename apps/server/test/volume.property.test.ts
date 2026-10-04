// Volume-safety properties (docs/quality-plan.md, "Volume-safety properties"). The
// rules, checked over random inputs: design §7 makes volume the one safety-critical path.
import fc from "fast-check";
import { describe, it } from "vitest";
import { decideVolume, MAX_RAISE_DB, VOLUME_EPS, type VolumeRequest } from "../src/volume.ts";

const db = (min: number, max: number) => fc.double({ min, max, noNaN: true });
/** A volume range like HQPlayer's (measured: −60…−3 on macOS, −60…0 on Linux), plus odd ones. */
const range = fc.tuple(db(-120, -10), db(-10, 12), fc.boolean()).map(([min, max, enabled]) => ({ min, max, enabled }));
const request: fc.Arbitrary<VolumeRequest> = range.chain((r) =>
  fc.record({
    requested: db(-200, 50),
    current: db(r.min, r.max),
    range: fc.constant(r),
    kind: fc.constantFrom("change" as const, "undo" as const, "rollback" as const),
    untouched: fc.boolean(),
  }),
);

describe("volume guard (properties)", () => {
  it("never sends a volume above the range's maximum", () => {
    fc.assert(fc.property(request, (r) => (decideVolume(r).set ?? -Infinity) <= r.range.max));
  });

  it("never raises more than 6 dB in one step, except undo returning to an untouched level", () => {
    fc.assert(
      fc.property(request, (r) => {
        const { set } = decideVolume(r);
        if (set === undefined || set - r.current <= MAX_RAISE_DB + VOLUME_EPS) return true;
        return r.kind === "undo" && r.untouched;
      }),
    );
  });

  it("a rollback never raises the volume at all", () => {
    fc.assert(
      fc.property(request, (r) => {
        const { set } = decideVolume({ ...r, kind: "rollback" });
        return set === undefined || set <= r.current + VOLUME_EPS;
      }),
    );
  });

  it("an undo of a raise of more than 6 dB happens only if nobody moved the volume since", () => {
    fc.assert(
      fc.property(request, (r) => {
        const { set } = decideVolume({ ...r, kind: "undo", untouched: false });
        return set === undefined || set - r.current <= MAX_RAISE_DB + VOLUME_EPS;
      }),
    );
  });

  it("never blocks lowering the volume within the range, by any amount", () => {
    // Generate lowerings directly: from random doubles they're rare, and big cuts rarer.
    const lowering = request
      .filter((r) => r.range.enabled)
      .chain((r) => fc.double({ min: r.range.min, max: r.current, noNaN: true }).map((requested) => ({ ...r, requested })));
    // === rather than toEqual: −0 dB and 0 dB are the same volume.
    fc.assert(
      fc.property(lowering, (r) => {
        const d = decideVolume(r);
        return d.set === r.requested && d.problem === undefined;
      }),
    );
  });

  it("sends nothing when volume control is disabled", () => {
    fc.assert(fc.property(request, (r) => decideVolume({ ...r, range: { ...r.range, enabled: false } }).set === undefined));
  });

  it("never sends a value that isn't a finite number", () => {
    const anything = fc.oneof(fc.double(), fc.constantFrom(NaN, Infinity, -Infinity));
    fc.assert(
      fc.property(request, anything, (r, requested) => {
        const { set } = decideVolume({ ...r, requested });
        return set === undefined || Number.isFinite(set);
      }),
    );
  });
});
