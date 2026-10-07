import { describe, expect, it } from "vitest";
import { dacName, hasDacs, scopeOf } from "./dac-scope.ts";

const one = { dacs: [{ id: "main", name: "" }], dac: "main" };
const two = {
  dacs: [
    { id: "main", name: "Holo" },
    { id: "desk", name: "Desk" },
  ],
  dac: "desk",
};

describe("named DACs on the screens", () => {
  it("keeps the main DAC under the instance id and another under id#dac, as the server does", () => {
    expect([scopeOf("mac", "main"), scopeOf("mac", undefined), scopeOf("mac", "desk")]).toEqual(["mac", "mac", "mac#desk"]);
  });

  it("shows the DAC picker only with more than one DAC", () => {
    expect([hasDacs(one), hasDacs(two), hasDacs(null)]).toEqual([false, true, false]);
  });

  it("names the DAC in use, or nothing with just the one", () => {
    expect([dacName(two), dacName(one)]).toEqual(["Desk", ""]);
  });
});
