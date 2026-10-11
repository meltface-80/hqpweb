import { describe, expect, it } from "vitest";
import { withoutRetired } from "./prefs-migrate.ts";

describe("stored preferences from older builds", () => {
  it("drop the classic layout's settings, whatever they were, and keep the rest", () => {
    const stored = { layout: "classic", filterOrder: "rating", adviceTab: "guide", theme: "dark", volumeStep: 2 };
    expect(withoutRetired(stored)).toEqual({ theme: "dark", volumeStep: 2 });
    expect(withoutRetired({ layout: "v2", meterOpen: true })).toEqual({ meterOpen: true });
  });
});
