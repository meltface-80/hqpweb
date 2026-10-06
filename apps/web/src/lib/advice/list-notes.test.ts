import { describe, expect, it } from "vitest";
import { NOT_WITH_VOLUME, withGuideNotes, withVolumeNotes, type ListRow } from "./list-notes.ts";

describe("list notes", () => {
  const rows = [
    { name: "NS9", note: "NS9 is designed for 176.4/192k" },
    { name: "LNS15", note: "LNS15 isn't recommended below 352.8k" },
    { name: "NS5", warn: "failed here before", note: "x" },
    { name: "TPDF" },
  ];

  it("replaces a soft note the guide contradicts on a row it recommends", () => {
    expect(withGuideNotes(rows, new Set(["NS9"]))[0]?.note).toBe("Suits your answers: see Guide");
  });

  it("keeps notes on rows the guide doesn't recommend", () => {
    expect(withGuideNotes(rows, new Set(["NS9"]))[1]?.note).toBe("LNS15 isn't recommended below 352.8k");
  });

  it("never touches a warning", () => {
    expect(withGuideNotes(rows, new Set(["NS5"]))[2]).toEqual(rows[2]);
  });

  it("leaves a recommended row without a note alone", () => {
    expect(withGuideNotes(rows, new Set(["TPDF"]))[3]).toEqual({ name: "TPDF" });
  });
});

describe("AHM 5L with HQPlayer volume", () => {
  const rows: ListRow[] = [{ name: "AHM7EC5L" }, { name: "AHM5EC5L" }, { name: "AHM7EC8B" }];

  it("notes that the 5L versions, both orders, don't suit HQPlayer's volume, when it sets the volume", () => {
    expect(withVolumeNotes(rows, { volume: "hqplayer" }).map((r) => r.note ?? null)).toEqual([
      NOT_WITH_VOLUME,
      NOT_WITH_VOLUME,
      null,
    ]);
  });

  it("leaves a warning alone", () => {
    const warned = [{ name: "AHM7EC5L", warn: "won't play here" }];
    expect(withVolumeNotes(warned, { volume: "hqplayer" })).toEqual(warned);
  });

  it("adds nothing when the volume is fixed or not answered", () => {
    expect([withVolumeNotes(rows, { volume: "fixed" }), withVolumeNotes(rows, {})]).toEqual([rows, rows]);
  });
});
