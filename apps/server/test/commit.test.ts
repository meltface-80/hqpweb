import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCommit } from "../src/commit.ts";

const sha = "0123456789abcdef0123456789abcdef01234567";
const dir = () => mkdtempSync(join(tmpdir(), "hqpweb-commit-"));

describe("buildCommit", () => {
  it("prefers a COMMIT file (the Docker build writes one)", () => {
    const d = dir();
    writeFileSync(join(d, "COMMIT"), "9f3bcda\n");
    expect(buildCommit(d)).toBe("9f3bcda");
  });

  it("follows .git/HEAD to a loose or packed ref, or a detached SHA", () => {
    const d = dir();
    mkdirSync(join(d, ".git/refs/heads"), { recursive: true });
    writeFileSync(join(d, ".git/HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(d, ".git/packed-refs"), `# pack-refs\n${sha} refs/heads/main\n`);
    expect(buildCommit(d)).toBe("0123456");
    writeFileSync(join(d, ".git/refs/heads/main"), `${"f".repeat(40)}\n`);
    expect(buildCommit(d)).toBe("fffffff");
    writeFileSync(join(d, ".git/HEAD"), `${sha}\n`);
    expect(buildCommit(d)).toBe("0123456");
  });

  it("is empty when nothing is known", () => {
    expect(buildCommit(dir())).toBe("");
  });
});
