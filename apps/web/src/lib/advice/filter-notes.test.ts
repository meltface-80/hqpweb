import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILTERS_V6 } from "../../../../../packages/protocol/src/fallback.ts";
import { SLOT_NOTE, filterNote } from "./filter-notes.ts";

// Every filter HQPlayer lists in the two captured profiles (Desktop 5, both modes), and v6's own.
const profile = (id: string) =>
  JSON.parse(readFileSync(new URL(`../../../../../packages/fake-hqp/profiles/${id}.json`, import.meta.url), "utf8")) as {
    lists: Record<string, { filters?: { name: string }[] }>;
  };
const NAMES = [
  ...new Set([
    ...["desktop5-mac-sdm", "desktop5-linux-pcm"].flatMap((p) =>
      Object.values(profile(p).lists).flatMap((l) => (l.filters ?? []).map((f) => f.name)),
    ),
    ...Object.keys(FILTERS_V6.sdm),
    ...Object.keys(FILTERS_V6.pcm),
  ]),
];

describe("filter notes", () => {
  it("cover every filter HQPlayer lists, each with at least one line and one source", () => {
    expect(NAMES.length).toBeGreaterThan(80);
    const missing = NAMES.filter((n) => !filterNote(n));
    expect(missing).toEqual([]);
    expect(NAMES.filter((n) => !filterNote(n)!.lines.length || !filterNote(n)!.cites.length)).toEqual([]);
  });
  it("link and date everything they cite from Jussi", () => {
    const bad = NAMES.flatMap((n) =>
      filterNote(n)!
        .cites.filter((c) => c.label === "Jussi")
        .filter((c) => !/^https:\/\/community\.roonlabs\.com\/t\//.test(c.url ?? "") || !/^\d{4}-\d{2}$/.test(c.date ?? ""))
        .map(() => n),
    );
    expect(bad).toEqual([]);
  });
  it("give the family, the filter's own line, its phase and two-stage where they apply", () => {
    const n = filterNote("poly-sinc-gauss-hires-lp")!;
    expect(n.lines[0]).toMatch(/^Gaussian/);
    expect(n.lines.join(" ")).toMatch(/default Nx filter/);
    expect(n.lines.join(" ")).toMatch(/Linear phase/);
    expect(filterNote("poly-sinc-short-mp-2s")!.lines.join(" ")).toMatch(/Two-stage/);
    expect(filterNote("poly-sinc-ext2-xla")!.lines.join(" ")).toMatch(/poly-sinc-ext3, renamed/);
  });
  it("say nothing for a name they don't know (a newer HQPlayer)", () => {
    expect(filterNote("poly-sinc-future-9")).toBeNull();
  });
  it("follow the 6.1.1 manual: Gaussians run in two stages for DSD, hires and halfband don't say so", () => {
    const text = (n: string) => filterNote(n)!.lines.join(" ");
    for (const n of ["short", "medium", "long", "xla", "xl"]) expect(text(`poly-sinc-gauss-${n}`)).toMatch(/two stages/);
    for (const n of ["hires-lp", "halfband"]) expect(text(`poly-sinc-gauss-${n}`)).not.toMatch(/two stages/);
    expect(text("sinc-medium")).toMatch(/upsample only/);
    expect(filterNote("sinc-M")!.cites.map((c) => c.label)).toContain("Manual 6.1.1 §4.6");
    expect(filterNote("poly-sinc-ext3")!.cites.map((c) => c.label)).toContain("Manual 5.13 §4.6");
  });
  it("explain the two slots, with HQPlayer's defaults and the Apod rule", () => {
    expect(SLOT_NOTE.lines.join(" ")).toMatch(/1x filter is used for CD-rate sources/);
    expect(SLOT_NOTE.lines.join(" ")).toMatch(/Apod counter passes about 10/);
  });
});
