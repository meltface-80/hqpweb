// A GitHub Release's title and notes, from the version's section of CHANGELOG.md, so the
// Releases page can't drift from the changelog. Used by the release workflow:
//
//   node tools/release/notes.ts v0.1.0-beta.3   → prints JSON {title, body, prerelease}
//
// Exits 1 when the changelog has no section for the version: a tag without notes fails
// the release step rather than publishing an empty page.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Notes {
  title: string;
  body: string;
  /** A pre-release version (0.1.0-beta.3): marked as such on GitHub. */
  prerelease: boolean;
}

/**
 * The changelog is hard-wrapped (prettier, ~88 columns); GitHub's Release pages show each
 * line break, so wrapped lines go back into their paragraph or list item. Headings,
 * tables, list starts, blank lines and fenced code are kept as they are.
 */
export function unwrap(md: string): string {
  const out: string[] = [];
  let code = false;
  const starts = (l: string) => /^\s*([-*+] |\d+\. |#|\||>|```)/.test(l);
  for (const line of md.split("\n")) {
    if (line.trimStart().startsWith("```")) code = !code;
    const prev = out.at(-1);
    const joinable =
      !code &&
      !line.trimStart().startsWith("```") &&
      line.trim() !== "" &&
      !starts(line) &&
      prev !== undefined &&
      prev.trim() !== "" &&
      !/^\s*(#|\||```)/.test(prev);
    if (joinable) out[out.length - 1] = `${prev} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

export function releaseNotes(changelog: string, version: string): Notes | null {
  const v = version.replace(/^v/, "");
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l === `## ${v}` || l.startsWith(`## ${v} `));
  if (start < 0) return null;
  const heading = lines[start]!;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  const body = unwrap(
    lines
      .slice(start + 1, end < 0 ? undefined : end)
      .join("\n")
      .trim(),
  );
  const subtitle = heading
    .slice(`## ${v}`.length)
    .replace(/^\s*—\s*/, "")
    .trim();
  return { title: subtitle ? `hqpweb ${v} — ${subtitle}` : `hqpweb ${v}`, body, prerelease: v.includes("-") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? "";
  const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  const notes = releaseNotes(changelog, version);
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${version || "(no version given)"}`);
    process.exit(1);
  }
  console.log(JSON.stringify(notes));
}
