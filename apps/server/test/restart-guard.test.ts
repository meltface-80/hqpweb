// Restart recovery's rule (restart-guard.ts): lower to the cap only after HQPlayer stopped
// answering and came back with a different volume, above the cap. Never raises.
import { describe, expect, it } from "vitest";
import { RestartGuard } from "../src/restart-guard.ts";

describe("after HQPlayer restarts", () => {
  it("lowers to the cap when it comes back louder than the cap, at a different volume", () => {
    const g = new RestartGuard();
    expect(g.answered(-24, -30)).toBeNull(); // first look: no restart seen
    g.failed();
    expect(g.answered(-15, -30)).toBe(-30); // relaunched at its saved -15
  });
  it("does nothing after a blip that left the volume alone", () => {
    const g = new RestartGuard();
    g.answered(-20, -30); // listening above the cap, by choice
    g.failed();
    expect(g.answered(-20, -30)).toBeNull();
  });
  it("never raises: back quieter than the cap stays as it is", () => {
    const g = new RestartGuard();
    g.answered(-24, -30);
    g.failed();
    expect(g.answered(-45, -30)).toBeNull();
  });
  it("does nothing without a cap, or without a failure first", () => {
    const g = new RestartGuard();
    g.answered(-24, undefined);
    g.failed();
    expect(g.answered(-15, undefined)).toBeNull();
    expect(g.answered(-5, -30)).toBeNull(); // a volume change while answering isn't a restart
  });
  it("acts once per restart", () => {
    const g = new RestartGuard();
    g.answered(-24, -30);
    g.failed();
    expect(g.answered(-15, -30)).toBe(-30);
    expect(g.answered(-15, -30)).toBeNull(); // the lowering's read-back hasn't landed yet: no repeat
  });
});
