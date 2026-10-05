// Claude Code PreToolUse hook (.claude/settings.json): the file-length tripwire at
// edit time, so an agent learns a file needs splitting at its first edit, not at
// commit. Reads the hook's JSON on stdin; prints a decision only when there's
// something to say. Anything unexpected (bad input, a file outside the repo, a missing
// file) is silent: the commit-time check is the backstop, and a hook must never get
// in the way of an edit it can't judge.
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeEdit, lines, project, type EditInput } from "./edit-length.ts";
import { CODE, type Counts } from "./length.ts";

interface Payload {
  tool_name?: string;
  // Field names as Claude Code sends them; `path` and `file_content` are also accepted,
  // since a docs summary named those.
  tool_input?: EditInput & { file_path?: string; path?: string; file_content?: string };
}

const root = fileURLToPath(new URL("../..", import.meta.url));

function decide(raw: string): object | undefined {
  const p = JSON.parse(raw) as Payload;
  const input = p.tool_input ?? {};
  const path = input.file_path ?? input.path;
  if (!p.tool_name || !path) return undefined;
  const file = relative(root, resolve(root, path));
  if (file.startsWith("..") || !CODE.test(file)) return undefined;
  let before = "";
  try {
    before = readFileSync(resolve(root, file), "utf8");
  } catch {
    // A new file: it starts empty.
  }
  const after = project(p.tool_name, before, { ...input, content: input.content ?? input.file_content });
  if (after === undefined) return undefined;
  const baseline = JSON.parse(readFileSync(new URL("length-baseline.json", import.meta.url), "utf8")) as Counts;
  const v = judgeEdit(file, lines(before), lines(after), baseline);
  if (v.kind === "block")
    return {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: v.reason },
    };
  if (v.kind === "warn") return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: v.note } };
  return undefined;
}

try {
  const out = decide(readFileSync(0, "utf8"));
  if (out) process.stdout.write(JSON.stringify(out));
} catch {
  // Silent by design (see above).
}
