import { describe, expect, it } from "vitest";
import { dotTitle } from "./connection.ts";

describe("the header dot's tooltip", () => {
  const base = { since: null, reason: "", latencyMs: 12, slow: false };
  it("says how HQPlayer is answering", () => {
    expect(dotTitle({ ...base, online: "live" })).toBe("Responding — 12 ms");
    expect(dotTitle({ ...base, online: "live", slow: true, latencyMs: 900 })).toBe("Responding — 900 ms (slow)");
    expect(dotTitle({ ...base, online: "live", latencyMs: undefined })).toBe("Responding — ? ms");
    expect(dotTitle({ ...base, online: "unreachable", reason: "timed out" })).toBe("Not responding: timed out");
    expect(dotTitle({ ...base, online: "unreachable", reason: "x", since: new Date(2026, 9, 8, 14, 5) })).toMatch(
      /^Not responding since .+: x$/,
    );
    expect(dotTitle({ ...base, online: "lost" })).toBe("Lost connection to the app's server");
    expect(dotTitle({ ...base, online: "connecting" })).toBe("Connecting…");
  });
});
