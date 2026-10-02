# CLAUDE.md — hqplayer-web-controller

A modern web controller for Signalyst HQPlayer. The design is
[`docs/design-v1.md`](docs/design-v1.md). Read it first: its §2 is a **measured fact
base**, not speculation, and the design follows from it.

**If `HANDOFF.local.md` exists, read it next.** It is git-ignored and holds the
operator's real environment, the rules for touching live HQPlayer instances, and how
to reach the session that did the groundwork.

## Hard rules

1. **This repo will be PUBLIC. No personal or location data, ever** (operator's firm
   requirement, 2026-10-02).
   - Never put real names, email addresses, **place names (the operator's homes or
     sites)**, hostnames, domain names, IP addresses, or anything from the operator's
     music library (paths, collection names, artists, albums) into **any** git
     content: files, **commit messages**, tags, branch names. Use invented examples
     (`192.0.2.x`, "Example Artist").
   - The hooks in `tools/hooks/` enforce this (`git config core.hooksPath tools/hooks`):
     `commit-msg` checks messages, and `pre-push` checks every outgoing commit's files and
     messages. Private terms live in the git-ignored `pii-denylist.local`. **Never bypass
     them (`--no-verify`)**; fix the text. Add new private terms to the denylist as they
     come up.
   - Anything about the operator's own network goes in `*.local.md`, which is
     git-ignored.
   - Before any push that could become public, run the operator's preflight scanner
     (path in `HANDOFF.local.md`).
2. **Git identity is already correct globally** (a pseudonym). Never set
   `user.name` / `user.email` locally, and never add `Co-Authored-By` lines that
   carry a real name.
3. **Live HQPlayer instances are someone's music system.**
   - **Reads** (`GetInfo`, `Status`, `State`, list commands) are always fine.
   - **Writes** (any `Set*`, `Volume`, mode, rate) need the operator's OK for that
     session, and must follow this protocol:
     1. snapshot `State`;
     2. apply;
     3. verify playback;
     4. restore;
     5. diff against the snapshot.
   - **Volume may only ever be lowered in tests.**
   - Volume is a float in dB. Parsing it as an integer yields 0 dB (full output).
4. **Never trust `result="OK"`.** Read `State` back after every change (design §2.1).
5. **Setters take list indices, and lists depend on mode and engine version.**
   Resolve by name at the moment of use; never cache indices across a mode change.
6. **No workaround for `ConfigurationLoad` auth.** Extracting keys from Signalyst's
   closed Client breaches its EULA. App-owned presets are the design (§4.3).

## Working agreements

- **Dry-run, or read-only first.** Show what a change will do before making it.
- **Say what you did not verify.** The fact base labels measured versus inferred;
  keep that discipline in code comments and PRs.
- **Commit with an explicit pathspec** (`git commit -m "…" -- path …`). Other
  sessions may share this working tree's index.
- **Licence:** MIT, confirmed by the operator 2026-10-02; `LICENSE` added.
- **README must keep the non-affiliation notice.** Don't use "HQPlayer" as the leading
  brand word in any app or package name.

## Tools

- `tools/probe/hqp.py HOST info|status|state|lists` and `tools/probe/hqp.py discover`
  are read-only, stdlib-only probes. Discovery is UDP multicast and does **not**
  cross VLANs or routed subnets.
