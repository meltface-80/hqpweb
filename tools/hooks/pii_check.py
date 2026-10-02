"""Block personal and location data from reaching git history.

Checks text (a commit message, or file contents) against:
  - generic patterns: private IPv4 ranges (not the 192.0.2.0/24 documentation
    range), email addresses other than GitHub noreply ones;
  - the operator's private terms: one regex per line in pii-denylist.local at the
    repo root. That file is git-ignored, because the terms are the private data.

Usage: pii_check.py message FILE  |  pii_check.py push <local_sha> <remote_sha>
Exit 1 with a report if anything matches. Never bypass with --no-verify.
"""
import os, re, subprocess, sys

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
GENERIC = [
    r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
    r"\b192\.168\.\d{1,3}\.\d{1,3}\b",
    r"\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b",
    r"[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com|anthropic\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
]
# Placeholders that are fine: documentation IPs and example names.
ALLOW = [r"192\.0\.2\.\d+", r"<machine>\.<tailnet>\.ts\.net"]

def patterns():
    pats = list(GENERIC)
    path = os.path.join(ROOT, "pii-denylist.local")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#"):
                pats.append(line)
    else:
        print("pii_check: warning: no pii-denylist.local; only generic patterns checked", file=sys.stderr)
    return [re.compile(p, re.I) for p in pats]

def scan(text, where, pats):
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        clean = line
        for a in ALLOW:
            clean = re.sub(a, "", clean)
        for p in pats:
            if p.search(clean):
                hits.append(f"{where}:{n}: matches a blocked pattern")
                break
    return hits

def main():
    pats = patterns()
    hits = []
    if sys.argv[1] == "message":
        hits = scan(open(sys.argv[2], encoding="utf-8").read(), "commit message", pats)
    elif sys.argv[1] == "push":
        local, remote = sys.argv[2], sys.argv[3]
        rng = local if set(remote) == {"0"} else f"{remote}..{local}"
        commits = subprocess.run(["git", "rev-list", rng], capture_output=True, text=True).stdout.split()
        for c in commits:
            msg = subprocess.run(["git", "log", "-1", "--format=%B", c], capture_output=True, text=True).stdout
            hits += scan(msg, f"message of {c[:7]}", pats)
            files = subprocess.run(["git", "diff-tree", "--no-commit-id", "--name-only", "-r", c], capture_output=True, text=True).stdout.split()
            for f in files:
                blob = subprocess.run(["git", "show", f"{c}:{f}"], capture_output=True)
                if blob.returncode == 0 and b"\0" not in blob.stdout[:4096]:
                    hits += scan(blob.stdout.decode("utf-8", "replace"), f"{c[:7]}:{f}", pats)
    if hits:
        print("BLOCKED: personal or location data would enter git history:", file=sys.stderr)
        for h in hits[:20]:
            print("  " + h, file=sys.stderr)
        print("Fix the text (reword the commit message or file); do not bypass.", file=sys.stderr)
        sys.exit(1)

main()
