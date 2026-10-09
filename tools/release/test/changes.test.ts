import { describe, expect, it } from "vitest";
import { fold, render, sectionOf, type Fragment } from "../changes.ts";

const f = (file: string, body: string): Fragment => ({ file, section: sectionOf(file)!, body });

describe("change notes (changes/)", () => {
  it("takes the section from the file name, skips the README, and refuses anything else", () => {
    expect(sectionOf("added.restart-cap.md")).toBe("Added");
    expect(sectionOf("fixed.history-settle.md")).toBe("Fixed");
    expect(sectionOf("README.md")).toBeNull();
    expect(() => sectionOf("misc.thing.md")).toThrow(/added\.\*\.md/);
  });
  it("renders in the changelog's order, Added, Changed, Fixed, leaving empty sections out", () => {
    const md = render([f("fixed.b.md", "- **B.** fixed"), f("added.a.md", "- **A.** new"), f("added.c.md", "- **C.** new")]);
    expect(md).toBe("### Added\n\n- **A.** new\n- **C.** new\n\n### Fixed\n\n- **B.** fixed\n");
  });
  it("folds a release in right after Unreleased, and refuses an empty or repeated one", () => {
    const log = "# Changelog\n\n## Unreleased\n\nNotes live in changes/.\n\n## 0.1.0-beta.5 — before\n\nold\n";
    const out = fold(log, "v0.1.0-beta.6", "after", [f("added.a.md", "- **A.** new")]);
    expect(out).toBe(
      "# Changelog\n\n## Unreleased\n\nNotes live in changes/.\n\n## 0.1.0-beta.6 — after\n\n### Added\n\n- **A.** new\n\n## 0.1.0-beta.5 — before\n\nold\n",
    );
    expect(() => fold(log, "0.1.0-beta.6", "", [])).toThrow(/no notes/);
    expect(() => fold(out, "0.1.0-beta.6", "", [f("added.a.md", "- x")])).toThrow(/already has/);
  });
});
