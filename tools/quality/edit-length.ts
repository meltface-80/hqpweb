// The file-length tripwire at edit time (docs/quality-plan.md, "File length"): before
// an agent's edit lands, how long will the file be, and what should it be told?
// Pure, so it can be tested; edit-hook.ts reads the hook's input and prints the answer.
import { LIMITS, type Counts } from "./length.ts";

/** Claude Code's Write, Edit and MultiEdit inputs: the parts that change a file's text. */
export interface EditInput {
  content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  edits?: { old_string: string; new_string: string; replace_all?: boolean }[];
}

const replace = (text: string, e: { old_string: string; new_string: string; replace_all?: boolean }) =>
  e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);

/** The file's text after the edit, or undefined when the edit can't be projected. */
export function project(tool: string, before: string, input: EditInput): string | undefined {
  if (tool === "Write") return input.content;
  if (tool === "Edit" && input.old_string !== undefined && input.new_string !== undefined)
    return replace(before, { old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all });
  if (tool === "MultiEdit" && input.edits) return input.edits.reduce(replace, before);
  return undefined;
}

/** Lines, counted like `wc -l`, as the tripwire counts them. */
export const lines = (text: string) => (text.match(/\n/g) ?? []).length;

export type EditVerdict = { kind: "block"; reason: string } | { kind: "warn"; note: string } | { kind: "quiet" };

/**
 * Block an edit that grows a file past what the tripwire allows (the limit, or its
 * baseline entry), since the commit would fail anyway. Warn on any edit that leaves a
 * file past the warning line, so the split happens now rather than at the limit. A
 * shrinking edit is never blocked or nagged: it's the split in progress.
 */
export function judgeEdit(
  file: string,
  before: number,
  after: number,
  baseline: Counts,
  limits: { fail: number; warn: number } = LIMITS,
): EditVerdict {
  if (after < before) return { kind: "quiet" };
  const allowed = baseline[file] ?? limits.fail;
  if (after > allowed && after > before)
    return {
      kind: "block",
      reason: `${file}: this edit takes it from ${before} to ${after} lines, over the ${allowed}-line limit. Split the file first (docs/quality-plan.md, "File length").`,
    };
  if (after > limits.warn)
    return {
      kind: "warn",
      note: `${file}: ${after} lines after this edit, past the ${limits.warn}-line warning (the limit is ${allowed}). Consider splitting it now, while it's easy.`,
    };
  return { kind: "quiet" };
}
