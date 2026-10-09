import { formatRate } from "./api.ts";
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./api.ts";
import { historyRows } from "./history-view.ts";

const fmt = formatRate;
const now = new Date("2026-10-08T16:00:00");
const e = (o: Partial<HistoryEntry>): HistoryEntry => ({
  at: "2026-10-08T15:42:00",
  instance: "mac",
  source: "hqpweb",
  changes: [{ field: "shaper", from: "ASDM7EC-super", to: "ASDM7EC-fast", applied: true }],
  playback: "playing",
  ...o,
});

describe("history rows", () => {
  it("groups by day, newest first, and says how each change went", () => {
    const days = historyRows(
      [
        e({}),
        e({ at: "2026-10-08T15:30:00", rolledBack: true, playback: "struggling", detail: "playing at 60% of real time" }),
        e({
          at: "2026-10-07T21:05:00",
          source: "elsewhere",
          changes: [{ field: "rate", from: 11_289_600, to: 45_158_400 }],
          playback: undefined,
        }),
      ],
      "all",
      fmt,
      now,
    );
    expect(days.map((d) => d.day)).toEqual(["Today", "Yesterday"]);
    expect(days[0]!.rows.map((r) => [r.what, r.how, r.tone])).toEqual([
      ["Modulator or dither → ASDM7EC-fast", "kept · playing", "ok"],
      ["Modulator or dither → ASDM7EC-fast", "playing at 60% of real time · rolled back", "bad"],
    ]);
    expect(days[1]!.rows[0]).toMatchObject({ what: "Rate → DSD1024", how: "made outside hqpweb", time: "21:05" });
  });

  it("filters: kept, rolled back, made elsewhere", () => {
    const list = [e({}), e({ rolledBack: true }), e({ source: "elsewhere" })];
    const count = (f: Parameters<typeof historyRows>[1]) => historyRows(list, f, fmt, now).flatMap((d) => d.rows).length;
    expect([count("all"), count("kept"), count("rolled-back"), count("elsewhere")]).toEqual([3, 1, 1, 1]);
  });

  it("names undo and presets, and says when HQPlayer didn't take a change", () => {
    const rows = historyRows(
      [
        e({ source: "undo" }),
        e({ source: "preset" }),
        e({ changes: [{ field: "convolution", from: false, to: false, applied: false }], playback: "not-checked" }),
      ],
      "all",
      fmt,
      now,
    )[0]!.rows;
    expect(rows.map((r) => r.how)).toEqual(["undo · kept · playing", "preset · kept · playing", "HQPlayer didn't take it"]);
  });
});
