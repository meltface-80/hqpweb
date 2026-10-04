import { describe, expect, it } from "vitest";
import { judge, ratchet } from "../tools/quality/length.ts";

const limits = { fail: 600, report: 400 };

describe("file-length tripwire", () => {
  it("fails a file over the limit that isn't in the baseline", () => {
    const v = judge({ "a.ts": 601 }, {}, limits);
    expect(v.failures).toEqual(["a.ts: 601 lines, over the 600-line limit. Split it."]);
  });

  it("passes a file at exactly the limit, and reports it", () => {
    const v = judge({ "a.ts": 600 }, {}, limits);
    expect(v.failures).toEqual([]);
    expect(v.reports).toEqual(["a.ts: 600 lines"]);
  });

  it("doesn't report a file at the report threshold", () => {
    expect(judge({ "a.ts": 400 }, {}, limits)).toEqual({ failures: [], reports: [] });
  });

  it("lets a baseline file stay at its recorded length", () => {
    expect(judge({ "big.ts": 900 }, { "big.ts": 900 }, limits).failures).toEqual([]);
  });

  it("fails a baseline file that grows by even one line", () => {
    expect(judge({ "big.ts": 901 }, { "big.ts": 900 }, limits).failures).toHaveLength(1);
  });

  it("fails a baseline file that shrank until the baseline is lowered", () => {
    expect(judge({ "big.ts": 850 }, { "big.ts": 900 }, limits).failures[0]).toContain("--ratchet");
  });

  it("fails a baseline entry whose file is gone", () => {
    expect(judge({}, { "big.ts": 900 }, limits).failures[0]).toContain("gone");
  });

  it("ratchet lowers entries, drops files back under the limit, and never adds or raises", () => {
    const counts = { "shrank.ts": 700, "grew.ts": 950, "fixed.ts": 500, "new.ts": 800 };
    const baseline = { "shrank.ts": 900, "grew.ts": 900, "fixed.ts": 900, "gone.ts": 900 };
    expect(ratchet(counts, baseline, limits)).toEqual({ "shrank.ts": 700, "grew.ts": 900 });
  });
});
