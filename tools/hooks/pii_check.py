"""Block personal and location data from reaching git history.

Checks text (a commit message, or file contents) against:
  - generic patterns: private, CGNAT and link-local IPv4 (not the 192.0.2.0/24
    documentation range), IPv6 ULA/link-local, MAC addresses, emails other than
    GitHub noreply ones, home-directory and mount paths, .local/.lan/.internal
    host names, tailnet names, UUIDs (device or account ids);
  - private terms: one regex per line in pii-denylist.local at the repo root.
    That file is git-ignored, because the terms are the private data.
On push it also checks each new commit's author and committer use a GitHub
noreply address (so a real email can't slip in from a global git config), and
image files for text metadata chunks.

Usage: pii_check.py message FILE  |  pii_check.py push <local_sha> <remote_sha>
Exit 1 with a report if anything matches. Never bypass with --no-verify.
"""
import os, re, subprocess, sys

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
GENERIC = [
    r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
    r"\b192\.168\.\d{1,3}\.\d{1,3}\b",
    r"\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b",
    r"\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b",  # CGNAT / Tailscale
    r"\b169\.254\.\d{1,3}\.\d{1,3}\b",
    r"\bf[cd][0-9a-f]{2}:[0-9a-f]{0,4}:[0-9a-f:]+",  # IPv6 ULA
    r"\bfe80:[0-9a-f:]*",
    r"\b[0-9a-f]{2}(:[0-9a-f]{2}){5}\b",  # MAC
    r"[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com|anthropic\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    r"/(Users|home)/(?!runner\b|node\b)[a-z][\w.-]+",
    r"(/Volumes/|/mnt/|smb://|nfs://)",
    r"\b[\w-]+\.(local|lan|internal|home)\b",
    r"\b[\w-]+\.[\w-]+\.ts\.net\b",
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
]
# Placeholders and public constants that are fine.
ALLOW = [
    r"192\.0\.2\.\d+",
    r"<machine>\.<tailnet>\.ts\.net",
    r"[\w*-]*\.local\.md", r"pii-denylist\.local", r"\*\.local\b",
    r"home\.arpa",
    r"00720724-5143-4a9b-abac-0e50cba674bb",  # Roon's public SOOD service id
    r"258EAFA5-E914-47DA-95CA-C5AB0DC85B11",  # RFC 6455 WebSocket GUID
]
IMAGE_EXT = (".png", ".ico", ".jpg", ".jpeg", ".gif", ".webp")
IMAGE_TEXT = (b"tEXt", b"iTXt", b"zTXt", b"eXIf", b"Exif")

SELF = "tools/hooks/pii_check.py"  # holds the patterns themselves

def image_has_text(path, data):
    """PNG: walk the chunks. Other images: look for metadata markers."""
    if path.lower().endswith(".png") and data[:8] == b"\x89PNG\r\n\x1a\n":
        pos = 8
        while pos + 8 <= len(data):
            length = int.from_bytes(data[pos:pos + 4], "big")
            if data[pos + 4:pos + 8] in IMAGE_TEXT:
                return True
            pos += 12 + length
        return False
    return any(t in data for t in IMAGE_TEXT)

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
        # Only commits GitHub doesn't already have: a branch shares history with main,
        # and commits GitHub itself made (PR merges, possibly merged back into a
        # branch) aren't ours to rewrite.
        args = [local, "--not", "--remotes"] + ([] if set(remote) == {"0"} else [remote])
        commits = subprocess.run(["git", "rev-list", *args], capture_output=True, text=True).stdout.split()
        for c in commits:
            meta = subprocess.run(["git", "log", "-1", "--format=%ae%n%ce", c], capture_output=True, text=True).stdout.split("\n")
            for email in meta[0:2]:
                if not email.endswith("@users.noreply.github.com"):
                    hits.append(f"{c[:7]}: author/committer is not a GitHub noreply address")
            msg = subprocess.run(["git", "log", "-1", "--format=%B", c], capture_output=True, text=True).stdout
            hits += scan(msg, f"message of {c[:7]}", pats)
            files = subprocess.run(["git", "diff-tree", "--no-commit-id", "--name-only", "-r", c], capture_output=True, text=True).stdout.split()
            for f in files:
                if f == SELF:
                    continue
                blob = subprocess.run(["git", "show", f"{c}:{f}"], capture_output=True)
                if blob.returncode == 0 and f.lower().endswith(IMAGE_EXT) and image_has_text(f, blob.stdout):
                    hits.append(f"{c[:7]}:{f}: image carries text/EXIF metadata; strip it")
                if blob.returncode == 0 and b"\0" not in blob.stdout[:4096]:
                    hits += scan(blob.stdout.decode("utf-8", "replace"), f"{c[:7]}:{f}", pats)
    if hits:
        print("BLOCKED: personal or location data would enter git history:", file=sys.stderr)
        for h in hits[:20]:
            print("  " + h, file=sys.stderr)
        print("Fix the text (reword the commit message or file); do not bypass.", file=sys.stderr)
        sys.exit(1)

main()
