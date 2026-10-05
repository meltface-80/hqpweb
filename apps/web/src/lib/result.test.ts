import { describe as group, expect, it } from "vitest";
import type { ApplyResult, FieldResult } from "./api.ts";
import { describe, notStartedMessage } from "./result.ts";

const show = (_f: unknown, v: string | number | boolean) => String(v);
const field = (f: FieldResult["field"], actual: string | number | boolean, applied = true): FieldResult =>
  ({ field: f, requested: actual, actual, applied }) as FieldResult;
const result = (over: Partial<ApplyResult>): ApplyResult =>
  ({ class: "quick", results: [], playback: { kind: "playing" }, rolledBack: null, undoAvailable: true, ...over }) as ApplyResult;
const rollback = (playback: ApplyResult["playback"], incompatible?: ApplyResult["incompatible"]) =>
  result({
    playback: { kind: "stopped", detail: "playback stopped" },
    rolledBack: { results: [field("rate", 176400)], playback },
    ...(incompatible ? { incompatible } : {}),
  });

group("the result message (moved from App.svelte)", () => {
  it("confirms an applied change with a ✓ and the playback check", () => {
    expect(describe(result({ results: [field("filter1x", "poly-sinc-gauss-long")] }), show, false)).toEqual({
      kind: "ok",
      text: "✓ 1x filter → poly-sinc-gauss-long · playback OK",
    });
  });

  it("says what HQPlayer reports when a setting didn't take", () => {
    const r = result({ results: [{ ...field("volume", -30, false), requested: -20 }] });
    expect(describe(r, show, false)).toEqual({ kind: "warn", text: "Volume: asked for -20, HQPlayer reports -30" });
  });

  it("lists skipped settings", () => {
    const r = result({ results: [field("shaper", "NS5")], skipped: [{ field: "rate", reason: "not offered here" }] });
    expect(describe(r, show, false).text).toContain("Skipped: Output rate (not offered here)");
  });
});

group("after a rollback", () => {
  it("says playback resumed, and offers nothing more", () => {
    const m = describe(rollback({ kind: "playing" }), show, false);
    expect(m.text).toContain("Playback resumed.");
    expect(m.restart).toBeUndefined();
  });

  it("offers Restart playback when HQPlayer's own playlist stayed stopped", () => {
    const m = describe(rollback({ kind: "stopped", detail: "playback stopped" }), show, false);
    expect(m.restart).toBe(true);
    expect(m.text).toContain("restart it below");
    expect(m.text).not.toContain("may need a restart");
  });

  it("points to Roon, without a restart button, when Roon was the source", () => {
    const m = describe(rollback({ kind: "stopped", detail: "playback stopped" }), show, true);
    expect(m.restart).toBeUndefined();
    expect(m.text).toContain("resume it in Roon");
  });

  it("explains a rule-based stop as HQPlayer's rule", () => {
    const m = describe(rollback({ kind: "playing" }, { level: "hard", text: "sinc-M needs a power-of-two ratio" }), show, false);
    expect(m.text).toMatch(/^Rolled back: sinc-M needs a power-of-two ratio\..*That's an HQPlayer rule/);
  });
});

group("after Play", () => {
  it("says nothing when HQPlayer started", () => {
    expect(notStartedMessage(undefined)).toBeNull();
  });

  it("explains a start that HQPlayer said OK to but didn't make, with the rule when one applies", () => {
    expect(notStartedMessage({ explained: "sinc-M needs a power-of-two ratio" })?.text).toBe(
      "HQPlayer didn't start: sinc-M needs a power-of-two ratio.",
    );
    expect(notStartedMessage({})?.text).toMatch(/output may be unavailable/);
  });
});
