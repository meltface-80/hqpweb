import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LearnedStore, type Failure } from "../src/learned.ts";

const f = (o: Partial<Failure> = {}): Failure => ({
  instance: "mac",
  engine: "5.35.10",
  mode: "SDM (DSD)",
  rateHz: 45_158_400,
  filterNx: "poly-sinc-gauss-hires-lp",
  filter1x: "poly-sinc-gauss-xla",
  shaper: "ASDM7EC",
  reason: "playing at 53% of real time",
  at: "2026-10-01T10:00:00.000Z",
  ...o,
});

describe("failure history, per instance, engine and combination", () => {
  it("counts repeat failures of the same combination, keeping the first and last dates", () => {
    const s = new LearnedStore(null);
    s.record(f());
    s.record(f({ at: "2026-10-03T10:00:00.000Z", reason: "playing at 60% of real time" }));
    expect(s.all("mac")).toEqual([
      expect.objectContaining({ count: 2, first: "2026-10-01T10:00:00.000Z", at: "2026-10-03T10:00:00.000Z" }),
    ]);
  });

  it("keeps different combinations, and other instances, apart", () => {
    const s = new LearnedStore(null);
    s.record(f());
    s.record(f({ shaper: "ASDM7EC-light" }));
    s.record(f({ instance: "lxc" }));
    expect([s.all("mac").length, s.all("lxc").length]).toEqual([2, 1]);
  });

  it("reads failures saved before counts existed as one each", () => {
    const path = join(mkdtempSync(join(tmpdir(), "learned-")), "learned.json");
    writeFileSync(path, JSON.stringify({ format: 1, failures: [f()] }));
    expect(new LearnedStore(path).all("mac")[0]).toMatchObject({ count: 1, first: "2026-10-01T10:00:00.000Z" });
  });
});
