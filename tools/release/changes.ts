// Changelog fragments: each change brings its own note in changes/, so pull requests don't
// all edit the top of CHANGELOG.md (it caused most merge conflicts). A release gathers them
// into a new version section of CHANGELOG.md and deletes them:
//
//   node tools/release/changes.ts preview                       → prints the gathered notes
//   node tools/release/changes.ts release 0.1.0-beta.6 "title"  → writes CHANGELOG.md, removes the notes
//
// A note is changes/<section>.<slug>.md, where section is added, changed or fixed; it holds
// one or more list items as they'd read in the changelog. changes/README.md says the same.
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SECTIONS = { added: "Added", changed: "Changed", fixed: "Fixed" } as const;
export type Section = (typeof SECTIONS)[keyof typeof SECTIONS];
export interface Fragment {
  file: string;
  section: Section;
  body: string;
}

/** A note's section from its file name; null for a file that isn't a note (README.md). Throws for a bad prefix. */
export function sectionOf(file: string): Section | null {
  if (!file.endsWith(".md") || file === "README.md") return null;
  const prefix = file.split(".")[0]!;
  const s = SECTIONS[prefix as keyof typeof SECTIONS];
  if (!s) throw new Error(`changes/${file}: name it added.*.md, changed.*.md or fixed.*.md`);
  return s;
}

export function readFragments(dir: string): Fragment[] {
  return readdirSync(dir)
    .sort()
    .flatMap((file) => {
      const section = sectionOf(file);
      return section ? [{ file, section, body: readFileSync(join(dir, file), "utf8").trim() }] : [];
    });
}

/** The notes as changelog sections, in the changelog's order: Added, Changed, Fixed. */
export function render(frags: Fragment[]): string {
  return Object.values(SECTIONS)
    .map((s) => {
      const items = frags.filter((f) => f.section === s && f.body).map((f) => f.body);
      return items.length ? `### ${s}\n\n${items.join("\n")}\n` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** CHANGELOG.md with a new version section, from the notes, right after Unreleased. */
export function fold(changelog: string, version: string, title: string, frags: Fragment[]): string {
  const notes = render(frags);
  if (!notes) throw new Error("no notes in changes/: a release needs at least one");
  const v = version.replace(/^v/, "");
  if (changelog.includes(`\n## ${v}\n`) || changelog.includes(`\n## ${v} `)) throw new Error(`CHANGELOG.md already has ${v}`);
  const lines = changelog.split("\n");
  const unreleased = lines.findIndex((l) => l === "## Unreleased");
  if (unreleased < 0) throw new Error("CHANGELOG.md has no ## Unreleased");
  const next = lines.findIndex((l, i) => i > unreleased && l.startsWith("## "));
  const at = next < 0 ? lines.length : next;
  const heading = `## ${v}${title ? ` — ${title}` : ""}`;
  return [...lines.slice(0, at), heading, "", notes, ...lines.slice(at)].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const dir = join(root, "changes");
  const [cmd, version, title = ""] = process.argv.slice(2);
  const frags = readFragments(dir);
  if (cmd === "preview") {
    console.log(render(frags) || "(no notes in changes/)");
  } else if (cmd === "release" && version) {
    const path = join(root, "CHANGELOG.md");
    writeFileSync(path, fold(readFileSync(path, "utf8"), version, title, frags));
    for (const f of frags) rmSync(join(dir, f.file));
    console.log(`CHANGELOG.md: ${version}, from ${frags.length} note(s); add the update note by hand if there is one.`);
  } else {
    console.error('usage: changes.ts preview | release <version> ["title"]');
    process.exit(1);
  }
}
