// The change history (what changed, when, from where, how it went) and the settings
// last seen in each mode (HQPlayer's State only reports the mode in use).
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HistoryStore, changedFields, type ModeLists } from "../src/history.ts";
import type { Settings } from "../src/settings.ts";

const S: Settings = {
  mode: "SDM (DSD)",
  rate: 11_289_600,
  filterNx: "poly-sinc-gauss-hires-lp",
  filter1x: "poly-sinc-gauss-xla",
  shaper: "ASDM7EC-super",
  volume: -30,
  invert: false,
  filter20k: false,
  adaptive: false,
  convolution: false,
  matrixProfile: "",
};
const entry = (o: object = {}) => ({
  at: "2026-10-08T15:00:00.000Z",
  instance: "mac",
  source: "hqpweb" as const,
  changes: [{ field: "shaper", from: "ASDM7EC-super", to: "ASDM7EC-fast", applied: true }],
  ...o,
});

describe("what changed between two readings", () => {
  it("lists changed settings by name, leaving volume out (knob turns aren't history)", () => {
    expect(changedFields(S, { ...S, shaper: "ASDM7EC-fast", volume: -25 })).toEqual([
      { field: "shaper", from: "ASDM7EC-super", to: "ASDM7EC-fast" },
    ]);
    expect(changedFields(S, { ...S })).toEqual([]);
  });
});

describe("history", () => {
  it("lists an instance's entries newest first, its DACs included, and caps the length", () => {
    const h = new HistoryStore(null, 3);
    h.push(entry({ at: "2026-10-08T15:00:00.000Z" }));
    h.push(entry({ at: "2026-10-08T15:01:00.000Z", instance: "mac#desk" }));
    h.push(entry({ at: "2026-10-08T15:02:00.000Z", instance: "office" }));
    h.push(entry({ at: "2026-10-08T15:03:00.000Z" }));
    expect(h.forInstance("mac").map((e) => e.at)).toEqual(["2026-10-08T15:03:00.000Z", "2026-10-08T15:01:00.000Z"]);
  });

  it("keeps the settings last seen in each mode, per DAC", () => {
    const h = new HistoryStore(null);
    h.seen("mac", S, "2026-10-08T15:00:00.000Z");
    h.seen("mac", { ...S, mode: "PCM", rate: 0, shaper: "NS9" }, "2026-10-08T15:05:00.000Z");
    h.seen("mac#desk", { ...S, shaper: "AHM7EC8B" }, "2026-10-08T15:06:00.000Z");
    expect(h.lastSeen("mac")).toEqual({
      "SDM (DSD)": expect.objectContaining({ shaper: "ASDM7EC-super", at: "2026-10-08T15:00:00.000Z" }),
      PCM: expect.objectContaining({ shaper: "NS9", rate: 0, at: "2026-10-08T15:05:00.000Z" }),
    });
  });

  it("saves both, reads them back, and forgets an instance with its DACs", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-"));
    const path = join(dir, "history.json");
    const h = new HistoryStore(path);
    h.push(entry());
    h.seen("mac#desk", S, "2026-10-08T15:00:00.000Z");
    const again = new HistoryStore(path);
    expect([again.forInstance("mac").length, Object.keys(again.lastSeen("mac#desk"))]).toEqual([1, ["SDM (DSD)"]]);
    again.forget("mac");
    expect([new HistoryStore(path).forInstance("mac"), new HistoryStore(path).lastSeen("mac#desk")]).toEqual([[], {}]);
  });

  it("reads a file without last-seen settings as empty, not corrupt", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-"));
    const path = join(dir, "history.json");
    writeFileSync(path, JSON.stringify({ format: 1, entries: [entry()] }));
    expect(new HistoryStore(path).forInstance("mac")).toHaveLength(1);
    expect(readdirSync(dir)).toEqual(["history.json"]);
  });
});

describe("each mode's lists as last read", () => {
  const l = (o: Partial<ModeLists> = {}): ModeLists => ({
    instance: "mac",
    engine: "5.35.10",
    mode: "PCM",
    filters: ["poly-sinc-gauss-xla"],
    shapers: ["NS9", "TPDF"],
    rates: [0, 705_600],
    at: "2026-10-08T15:00:00.000Z",
    ...o,
  });
  it("keeps the latest per instance, engine and mode, and forgets with the instance", () => {
    const h = new HistoryStore(null);
    h.listsSeen(l());
    h.listsSeen(l({ shapers: ["NS9"] }));
    h.listsSeen(l({ mode: "SDM (DSD)", shapers: ["AHM7EC8B"] }));
    h.listsSeen(l({ engine: "6.1.0", shapers: ["LNS15"] }));
    h.listsSeen(l({ instance: "office" }));
    expect(h.modeLists("mac", "5.35.10")).toEqual({
      PCM: expect.objectContaining({ shapers: ["NS9"] }),
      "SDM (DSD)": expect.objectContaining({ shapers: ["AHM7EC8B"] }),
    });
    h.forget("mac");
    expect(h.modeLists("mac", "5.35.10")).toEqual({});
    expect(Object.keys(h.modeLists("office", "5.35.10"))).toEqual(["PCM"]);
  });
  it("persists, and rewrites the file only when the lists change", () => {
    const dir = mkdtempSync(join(tmpdir(), "hqpweb-lists-"));
    const path = join(dir, "history.json");
    const h = new HistoryStore(path);
    h.listsSeen(l());
    writeFileSync(path, JSON.stringify({ format: 1, entries: [], lists: [l({ shapers: ["marker"] })] }));
    h.listsSeen(l({ at: "2026-10-08T16:00:00.000Z" })); // same lists: no write
    expect(new HistoryStore(path).modeLists("mac", "5.35.10").PCM?.shapers).toEqual(["marker"]);
    h.listsSeen(l({ shapers: ["TPDF"] })); // changed: written
    expect(new HistoryStore(path).modeLists("mac", "5.35.10").PCM?.shapers).toEqual(["TPDF"]);
  });
});
