import { describe, expect, it } from "vitest";
import type { Capabilities, Snapshot } from "./api.ts";
import {
  changeFor,
  choicesFor,
  comparableModes,
  hearing,
  inMode,
  nowSide,
  switchNote,
  withPreset,
  type Side,
} from "./compare.ts";

const DSD256 = 11_289_600;
const caps = {
  mode: { index: 2, name: "SDM (DSD)", value: 1 },
  modes: [
    { index: 0, name: "[source]", value: -1 },
    { index: 1, name: "PCM", value: 0 },
    { index: 2, name: "SDM (DSD)", value: 1 },
  ],
  filters: [
    { index: 0, name: "poly-sinc-gauss-xla" },
    { index: 1, name: "poly-sinc-gauss-hires-lp" },
  ],
  shapers: [
    { index: 0, name: "ASDM7EC-fast" },
    { index: 1, name: "AHM7EC8B" },
  ],
  rates: [
    { index: 0, rate: 0, allowed: true },
    { index: 1, rate: DSD256, allowed: true },
  ],
  lastSeen: { PCM: { rate: 705_600, filter1x: "sinc-M", filterNx: "sinc-L", shaper: "NS9", at: "" } },
  modeLists: {},
} as unknown as Capabilities;
const snap = { state: { filter1x: 0, filterNx: 1, shaper: 0, rate: 1 } } as unknown as Snapshot;
const A: Side = {
  mode: "SDM (DSD)",
  filter1x: "poly-sinc-gauss-xla",
  filterNx: "poly-sinc-gauss-hires-lp",
  shaper: "ASDM7EC-fast",
  rate: DSD256,
};

describe("the two sides", () => {
  it("reads what's playing by name", () => {
    expect(nowSide(caps, snap)).toEqual(A);
  });
  it("offers the mode in use live, another mode as last read, and nothing for one never seen", () => {
    expect(choicesFor(caps, "SDM (DSD)")?.shapers).toEqual(["ASDM7EC-fast", "AHM7EC8B"]);
    expect(choicesFor(caps, "PCM")).toBeNull();
    const seen = { ...caps, modeLists: { PCM: { filters: ["sinc-M"], shapers: ["NS9"], rates: [], at: "" } } } as Capabilities;
    expect(choicesFor(seen, "PCM")?.shapers).toEqual(["NS9"]);
  });
  it("leaves [source] out: it has no settings of its own", () => {
    expect(comparableModes(caps)).toEqual(["PCM", "SDM (DSD)"]);
  });
  it("moves a side to another mode with that mode's settings as last seen, else the same names at auto", () => {
    expect(inMode(A, "PCM", caps)).toEqual({ mode: "PCM", filter1x: "sinc-M", filterNx: "sinc-L", shaper: "NS9", rate: 705_600 });
    expect(inMode(A, "PCM", { ...caps, lastSeen: {} } as Capabilities)).toEqual({ ...A, mode: "PCM", rate: 0 });
  });
  it("lays a preset over a side, in the preset's mode", () => {
    expect(withPreset(A, { shaper: "AHM7EC8B" }, caps)).toEqual({ ...A, shaper: "AHM7EC8B" });
    expect(withPreset(A, { mode: "PCM", shaper: "TPDF" }, caps)).toMatchObject({
      mode: "PCM",
      filter1x: "sinc-M",
      shaper: "TPDF",
    });
  });
});

describe("switching between them", () => {
  const B = { ...A, shaper: "AHM7EC8B" };
  it("sends only what differs", () => {
    expect(changeFor(B, A)).toEqual({ shaper: "AHM7EC8B" });
    expect(changeFor(A, A)).toEqual({});
  });
  it("sends the rate with a mode switch, even auto, so the server doesn't substitute the last-seen rate", () => {
    const P = { ...A, mode: "PCM", shaper: "NS9", rate: 0 };
    expect(changeFor(P, { ...A, rate: 0 })).toEqual({ mode: "PCM", shaper: "NS9", rate: 0 });
  });
  it("tells which side is playing from State, and neither when it's something else", () => {
    expect(hearing(A, A, B)).toBe("A");
    expect(hearing(B, A, B)).toBe("B");
    expect(hearing({ ...A, filter1x: "x" }, A, B)).toBeNull();
  });
  it("says what a switch costs: a pause and unmatched levels across modes, a gap across rates", () => {
    expect(switchNote(A, { ...A, mode: "PCM" })).toHaveLength(2);
    expect(switchNote(A, { ...A, mode: "PCM" })[1]).toMatch(/Levels aren't matched/);
    expect(switchNote(A, { ...A, rate: 0 })[0]).toMatch(/gap/);
    expect(switchNote(A, B)[0]).toMatch(/quickest/);
    expect(switchNote(A, A)[0]).toMatch(/the same/);
  });
});
