import { describe as group, expect, it } from "vitest";
import { fieldLabel, type ApplyResult, type FieldResult } from "./api.ts";
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
    expect(m.text).toMatch(/^Rolled back to how it was: sinc-M needs a power-of-two ratio\..*That's an HQPlayer rule/);
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

group("the playback note on a successful change (found by mutation testing)", () => {
  const ok = (playback: ApplyResult["playback"]) =>
    describe(result({ results: [field("shaper", "NS5")], playback }), show, false).text;
  it("says it wasn't checked because nothing was playing", () => {
    expect(ok({ kind: "not-checked", detail: "nothing was playing, so playback couldn't be checked" })).toBe(
      "✓ Dither → NS5 · not playing, so not checked",
    );
  });
  it("says why a check was inconclusive", () => {
    expect(ok({ kind: "inconclusive", detail: "playback was paused during the check" })).toBe(
      "✓ Dither → NS5 · playback not checked (playback was paused during the check)",
    );
  });
  it("adds nothing for a change that can't stop playback", () => {
    expect(ok({ kind: "not-checked", detail: "this change can't stop playback" })).toBe("✓ Dither → NS5");
  });
});

group("the dither or modulator is named as the picker names it", () => {
  const changed = (activeMode: number, name: string) =>
    describe(
      result({ results: [field("shaper", name)], playback: { kind: "playing" }, state: { activeMode } as ApplyResult["state"] }),
      show,
      false,
    ).text;
  it("says Dither in PCM mode", () => {
    expect(changed(0, "NS5")).toBe("✓ Dither → NS5 · playback OK");
  });
  it("says Modulator in SDM mode", () => {
    expect(changed(1, "AHM7EC8B")).toBe("✓ Modulator → AHM7EC8B · playback OK");
  });
});

group("field names", () => {
  it("name the shaper by mode, and both when the mode isn't known; other fields as before", () => {
    expect(fieldLabel("shaper", false)).toBe("Dither");
    expect(fieldLabel("shaper", true)).toBe("Modulator");
    expect(fieldLabel("shaper")).toBe("Dither or modulator");
    expect(fieldLabel("filter1x", true)).toBe("1x filter");
  });
});
