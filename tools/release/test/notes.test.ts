import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseNotes, unwrap } from "../notes.ts";

const CHANGELOG = `# Changelog

Intro.

## Unreleased

- Not yet.

## 0.2.0-beta.1 — a second thing

**Update:** pull.

### Added

- Two.

## 0.1.0 — a first thing

- One.
`;

describe("unwrapping the changelog's hard-wrapped lines (GitHub shows each as a break)", () => {
  it("joins a wrapped paragraph and a wrapped list item, and keeps blank lines and new items", () => {
    const md = "**Update:** pull,\nthen restart.\n\n- **One** wraps\n  onto two lines.\n- Two.";
    expect(unwrap(md)).toBe("**Update:** pull, then restart.\n\n- **One** wraps onto two lines.\n- Two.");
  });

  it("leaves headings, tables and code blocks alone", () => {
    const md = "### Added\n\n| a | b |\n| - | - |\n\n```sh\nline one\nline two\n```";
    expect(unwrap(md)).toBe(md);
  });
});

describe("release notes from the changelog", () => {
  it("takes the version's section: its subtitle as the title, the rest as the body", () => {
    expect(releaseNotes(CHANGELOG, "0.2.0-beta.1")).toEqual({
      title: "hqpweb 0.2.0-beta.1 — a second thing",
      body: "**Update:** pull.\n\n### Added\n\n- Two.",
      prerelease: true,
    });
  });

  it("marks a version without a pre-release part as a full release", () => {
    expect(releaseNotes(CHANGELOG, "0.1.0")).toMatchObject({ body: "- One.", prerelease: false });
  });

  it("accepts the tag form (v0.1.0)", () => {
    expect(releaseNotes(CHANGELOG, "v0.1.0")?.title).toBe("hqpweb 0.1.0 — a first thing");
  });

  it("gives nothing for a version the changelog doesn't have, so the release step fails", () => {
    expect(releaseNotes(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("finds every tagged beta in the real changelog", () => {
    const real = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
    expect(["0.1.0-beta.1", "0.1.0-beta.2", "0.1.0-beta.3"].map((v) => releaseNotes(real, v) !== null)).toEqual([
      true,
      true,
      true,
    ]);
  });
});
