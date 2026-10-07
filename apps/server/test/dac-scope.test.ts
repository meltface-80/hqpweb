import { describe, expect, it } from "vitest";
import { MAIN, MAX_DACS, addDac, cleanDacs, removeDac, renameDac, scopeOf, selectDac } from "../src/dac-scope.ts";

// The same model as MusicD-Remote (Rouen) 1.8.85's lib/hqp/players.js, so data saved by
// either keeps its meaning when the other ports this code.
describe("DACs behind one HQPlayer", () => {
  it("always has the main DAC first, unnamed, when none were set up", () => {
    expect(cleanDacs(undefined)).toEqual([{ id: MAIN, name: "" }]);
  });

  it("puts main first and drops duplicates and bad ids from a stored list", () => {
    const stored = [
      { id: "desk", name: "Desk" },
      { id: MAIN, name: "Holo" },
      { id: "desk", name: "Again" },
      { id: "Bad Id", name: "x" },
    ];
    expect(cleanDacs(stored)).toEqual([
      { id: MAIN, name: "Holo" },
      { id: "desk", name: "Desk" },
    ]);
  });

  it("names the first DAC when a second is added, and makes the id from the name", () => {
    const r = addDac(cleanDacs(undefined), { name: "Desk DAC", currentName: "Holo" });
    expect([r.dacs, r.dac]).toEqual([
      [
        { id: MAIN, name: "Holo" },
        { id: "desk-dac", name: "Desk DAC" },
      ],
      { id: "desk-dac", name: "Desk DAC" },
    ]);
  });

  it("calls an unnamed first DAC 'First DAC' when no name is given for it", () => {
    expect(addDac(cleanDacs(undefined), { name: "Desk" }).dacs[0]).toEqual({ id: MAIN, name: "First DAC" });
  });

  it("refuses a name already used (any case), and numbers a repeated id", () => {
    const two = addDac(cleanDacs(undefined), { name: "Desk", currentName: "Holo" }).dacs;
    expect(() => addDac(two, { name: "desk" })).toThrow(/already a DAC/);
    const renamed = renameDac(two, "desk", "Office");
    expect(addDac(renamed, { name: "Desk" }).dac.id).toBe("desk-2");
  });

  it("never makes the reserved id 'main' from a name", () => {
    expect(addDac(cleanDacs(undefined), { name: "Main", currentName: "Holo" }).dac.id).toBe("main-dac");
  });

  it(`stops at ${MAX_DACS} DACs`, () => {
    let dacs = cleanDacs(undefined);
    for (let i = 1; i < MAX_DACS; i++) dacs = addDac(dacs, { name: `D${i}`, currentName: "Holo" }).dacs;
    expect(() => addDac(dacs, { name: "One more" })).toThrow(/most DACs/);
  });

  it("can rename but never remove the first DAC", () => {
    const two = addDac(cleanDacs(undefined), { name: "Desk", currentName: "Holo" }).dacs;
    expect(renameDac(two, MAIN, "Cyan")[0]!.name).toBe("Cyan");
    expect(() => removeDac(two, MAIN, MAIN)).toThrow(/can't be removed|renamed but not removed/);
  });

  it("removing the one in use falls back to main; down to one, its name is cleared (no picker)", () => {
    const two = addDac(cleanDacs(undefined), { name: "Desk", currentName: "Holo" }).dacs;
    expect(removeDac(two, "desk", "desk")).toEqual({ dacs: [{ id: MAIN, name: "" }], dac: MAIN });
  });

  it("chooses only a DAC that exists", () => {
    const two = addDac(cleanDacs(undefined), { name: "Desk", currentName: "Holo" }).dacs;
    expect(selectDac(two, "desk")).toBe("desk");
    expect(() => selectDac(two, "nope")).toThrow(/no such DAC/);
  });

  it("keeps everything for the main DAC under the HQPlayer's own id, and a second DAC's under id#dac", () => {
    expect([scopeOf("office", MAIN), scopeOf("office", undefined), scopeOf("office", "desk")]).toEqual([
      "office",
      "office",
      "office#desk",
    ]);
  });

  it("keeps a DAC's reserved output field (for when HQPlayer can report one) and its own answers", () => {
    const stored = [
      { id: MAIN, name: "Holo" },
      { id: "desk", name: "Desk", output: "naa-1/hw:0", setup: { pcm: "ladder" } },
    ];
    expect(cleanDacs(stored)[1]).toEqual({ id: "desk", name: "Desk", output: "naa-1/hw:0", setup: { pcm: "ladder" } });
  });
});
