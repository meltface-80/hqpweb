import { describe, expect, it } from "vitest";
import { matrixChoices, whereShort, whereToSetUp } from "./matrix-row.ts";

describe("the matrix profile row", () => {
  it("says so when no profiles are set up, with nothing to pick", () => {
    expect(matrixChoices([], "")).toEqual({ choices: [], current: "No profiles created" });
  });

  it('leads with Default (no profile, sent as ""), then the profiles, and reads the one in use', () => {
    const { choices, current } = matrixChoices(["Holo correction", "No Pipeline"], "");
    expect(choices.map((c) => [c.name, c.value])).toEqual([
      ["Default", ""],
      ["Holo correction", "Holo correction"],
      ["No Pipeline", "No Pipeline"],
    ]);
    expect(current).toBe("Default");
    expect(matrixChoices(["Holo correction"], "Holo correction").current).toBe("Holo correction");
  });

  it("calls no profile 'No profile' where a profile is itself named Default, so they can't be confused", () => {
    const { choices, current } = matrixChoices(["Default", "Mixdown"], "");
    expect(choices.map((c) => [c.name, c.value])).toEqual([
      ["No profile", ""],
      ["Default", "Default"],
      ["Mixdown", "Mixdown"],
    ]);
    expect(current).toBe("No profile");
    expect(matrixChoices(["Default"], "Default").current).toBe("Default");
  });

  it("says where profiles are set up, for Desktop, Embedded, or either when it can't tell", () => {
    expect(whereToSetUp("Signalyst HQPlayer Desktop")).toMatch(/Desktop, under its Matrix \/ Pipeline menu/);
    expect(whereToSetUp("Signalyst HQPlayer Embedded")).toMatch(/Embedded's web page \(port 8088\), under Pipeline/);
    expect(whereToSetUp(undefined)).toMatch(/Desktop's .* or Embedded's/);
  });

  it("says it again in a few words, once the help has been collapsed", () => {
    expect(whereShort("Signalyst HQPlayer Desktop")).toBe("Set up in Desktop's Matrix / Pipeline menu.");
    expect(whereShort("Signalyst HQPlayer Embedded")).toBe("Set up in Embedded's Pipeline page.");
    expect(whereShort(undefined).split(" ").length).toBeLessThanOrEqual(8);
  });
});
