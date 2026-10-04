// The git commit this build came from, so deploys can be told apart. Read from a
// COMMIT file (written during the Docker build) or, in development, from .git.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHA = /^[0-9a-f]{40}$/;

/** Short commit for the checkout at `root`; "" when unknown. */
export function buildCommit(root: string): string {
  const read = (p: string) => {
    try {
      return readFileSync(join(root, p), "utf8").trim();
    } catch {
      return "";
    }
  };
  const file = read("COMMIT");
  if (/^[0-9a-f]{7,40}$/.test(file)) return file.slice(0, 7);
  const head = read(".git/HEAD");
  if (!head.startsWith("ref: ")) return SHA.test(head) ? head.slice(0, 7) : "";
  const ref = head.slice(5);
  const loose = read(`.git/${ref}`);
  const packed =
    read(".git/packed-refs")
      .split("\n")
      .find((l) => l.endsWith(` ${ref}`))
      ?.split(" ")[0] ?? "";
  const sha = loose || packed;
  return SHA.test(sha) ? sha.slice(0, 7) : "";
}
