import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { judgeEdit, lines, project } from "../tools/quality/edit-length.ts";

const limits = { fail: 600, warn: 500 };
const text = (n: number) => "x\n".repeat(n);

describe("edit-time length check: projecting the edit", () => {
  it("takes a Write's content as the new text", () => {
    expect(project("Write", "old\n", { content: "a\nb\n" })).toBe("a\nb\n");
  });

  it("replaces an Edit's first match only, unless replace_all", () => {
    const one = project("Edit", "a a", { old_string: "a", new_string: "b" });
    const all = project("Edit", "a a", { old_string: "a", new_string: "b", replace_all: true });
    expect([one, all]).toEqual(["b a", "b b"]);
  });

  it("inserts new_string literally, even with $ patterns in it", () => {
    expect(project("Edit", "a", { old_string: "a", new_string: "$&$&" })).toBe("$&$&");
  });

  it("applies a MultiEdit's edits in order", () => {
    expect(
      project("MultiEdit", "a", {
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "b", new_string: "c\n" },
        ],
      }),
    ).toBe("c\n");
  });

  it("can't project a tool that doesn't edit a file", () => {
    expect(project("Read", "a", {})).toBeUndefined();
  });

  it("counts lines like wc -l", () => {
    expect([lines(""), lines("a"), lines("a\n"), lines("a\nb")]).toEqual([0, 0, 1, 1]);
  });
});

describe("edit-time length check: the verdict", () => {
  it("blocks an edit that takes a file over the limit", () => {
    expect(judgeEdit("a.ts", 590, 601, {}, limits).kind).toBe("block");
  });

  it("allows an edit that lands exactly on the limit, with a warning", () => {
    expect(judgeEdit("a.ts", 590, 600, {}, limits).kind).toBe("warn");
  });

  it("warns on an edit that leaves a file past the warning line", () => {
    expect(judgeEdit("a.ts", 500, 501, {}, limits).kind).toBe("warn");
  });

  it("warns on an edit past the warning line that doesn't change the length", () => {
    expect(judgeEdit("a.ts", 550, 550, {}, limits).kind).toBe("warn");
  });

  it("says nothing about a file at or below the warning line", () => {
    expect(judgeEdit("a.ts", 100, 500, {}, limits).kind).toBe("quiet");
  });

  it("doesn't nag an edit that shrinks a file past the warning line", () => {
    expect(judgeEdit("a.ts", 560, 540, {}, limits).kind).toBe("quiet");
  });

  it("never blocks an edit that shrinks a file already over the limit, so it can be split", () => {
    expect(judgeEdit("a.ts", 900, 899, {}, limits).kind).toBe("quiet");
  });

  it("blocks a baseline file growing past its recorded length, though under its own old size", () => {
    expect(judgeEdit("big.ts", 700, 701, { "big.ts": 700 }, limits).kind).toBe("block");
  });
});

describe("edit-time length check: the hook script", () => {
  const hook = (payload: unknown) =>
    execFileSync("node", ["tools/quality/edit-hook.ts"], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
    });
  const write = (file_path: string, n: number) => ({ tool_name: "Write", tool_input: { file_path, content: text(n) } });

  it("denies a Write that creates a code file over the limit, with the reason", () => {
    const out = JSON.parse(hook(write("tools/quality/new-file.ts", 601))) as { hookSpecificOutput: Record<string, string> };
    expect([out.hookSpecificOutput.permissionDecision, out.hookSpecificOutput.permissionDecisionReason]).toEqual([
      "deny",
      expect.stringContaining("from 0 to 601 lines"),
    ]);
  });

  it("adds a note, without deciding, for a Write past the warning line", () => {
    const out = JSON.parse(hook(write("tools/quality/new-file.ts", 550))) as { hookSpecificOutput: Record<string, string> };
    expect([out.hookSpecificOutput.permissionDecision, out.hookSpecificOutput.additionalContext]).toEqual([
      undefined,
      expect.stringContaining("Consider splitting"),
    ]);
  });

  it("ignores files the tripwire doesn't measure", () => {
    expect(hook(write("docs/notes.md", 5000))).toBe("");
  });

  it("ignores files outside the repository", () => {
    expect(hook(write("/elsewhere/big.ts", 5000))).toBe("");
  });

  it("stays silent, and lets the edit through, on input it can't read", () => {
    expect(hook("not json")).toBe("");
  });
});
