import { describe, expect, it } from "vitest";
import { RECENT_MS, recentChange, restartSteps, restartPlayback } from "./recovery.ts";

describe("how to restart HQPlayer when it stops answering", () => {
  it("tells Desktop users to quit and reopen it", () => {
    expect(restartSteps("Signalyst HQPlayer 5 Desktop").steps.join(" ")).toMatch(/[Qq]uit HQPlayer/);
  });

  it("gives Embedded users Signalyst's service restart, and the machine as the fallback", () => {
    const s = restartSteps("Signalyst HQPlayer Embedded").steps.join(" ");
    expect([s.includes("systemctl restart hqplayerd"), /restart the HQPlayer machine/i.test(s)]).toEqual([true, true]);
  });

  it("covers both when the product isn't known", () => {
    const s = restartSteps(undefined).steps.join(" ");
    expect([/[Qq]uit HQPlayer/.test(s), s.includes("systemctl")]).toEqual([true, true]);
  });

  it("always says it comes back on its saved settings", () => {
    expect(restartSteps("Signalyst HQPlayer Embedded").after).toMatch(/saved settings/);
  });
});

describe("tying an overload to a recent change", () => {
  const at = new Date(2026, 9, 6, 12, 3).getTime();

  it("names a risky change made in the last few minutes", () => {
    expect(recentChange(at, at + 2 * 60_000)).toBe(true);
  });

  it("doesn't blame a change made long before", () => {
    expect([recentChange(at, at + RECENT_MS + 1), recentChange(null, at)]).toEqual([false, false]);
  });
});

describe("restarting playback after a rollback", () => {
  const wait = () => Promise.resolve();
  it("stops, then plays, and says so", async () => {
    const calls: string[] = [];
    const r = await restartPlayback({
      stop: async () => void calls.push("stop"),
      play: async () => (calls.push("play"), { status: "playing" }),
      wait,
    });
    expect(calls).toEqual(["stop", "play"]);
    expect(r).toEqual({ message: { kind: "ok", text: "✓ Playback restarted" }, status: "playing" });
  });
  it("warns when HQPlayer didn't start, and reports an error as one", async () => {
    const no = await restartPlayback({ stop: async () => {}, play: async () => ({ status: "stopped", notStarted: {} }), wait });
    expect(no.message.kind).toBe("warn");
    const err = await restartPlayback({ stop: () => Promise.reject(new Error("gone")), play: async () => ({ status: 0 }), wait });
    expect(err).toEqual({ message: { kind: "error", text: "gone" } });
  });
});
