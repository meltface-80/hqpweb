# CLAUDE.md — guidance for AI assistants (and humans) working on hqpweb

A web controller for Signalyst HQPlayer. The design is
[`docs/design-v1.md`](docs/design-v1.md). Read it first: its §2 is a **measured fact
base**, not speculation, and the design follows from it.

A git-ignored `HANDOFF.local.md`, if present, describes a maintainer's own test
environment. Read it if it exists; never commit anything from it.

## Hard rules

1. **This repo is public. No personal or location data, ever.**
   - Never put real names, email addresses, place names, hostnames, domain names, IP
     addresses, or anything from a real music library (paths, collection names,
     artists, albums) into **any** git content: files, commit messages, tags, branch
     names. Use invented examples (`192.0.2.x`, "Example Artist").
   - The hooks in `tools/hooks/` enforce this (`git config core.hooksPath tools/hooks`):
     `commit-msg` checks messages; `pre-push` checks every outgoing commit's files,
     messages and identity (a GitHub noreply email). Private terms go in the git-ignored
     `pii-denylist.local`. **Never bypass the hooks (`--no-verify`)**; fix the text.
   - Anything about a maintainer's own network goes in `*.local.md`, which is
     git-ignored.
2. **Never set `user.name` / `user.email` in this repo**, and never add
   `Co-Authored-By` lines that carry a real name.
3. **Live HQPlayer instances are someone's music system.**
   - **Reads** (`GetInfo`, `Status`, `State`, list commands) are always fine.
   - **Writes** (any `Set*`, `Volume`, mode, rate) need the owner's OK for that
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
  sessions may share the working tree's index.
- **Licence:** MIT (`LICENSE`); third-party notices in `THIRD_PARTY_NOTICES.md`.
- **Don't copy HQPlayer's manual** (its EULA forbids it): paraphrase and cite sections.
- **README must keep the non-affiliation notices.** Don't use "HQPlayer" or "Roon"
  as the leading brand word in any app or package name.

## Code quality

[docs/quality-plan.md](docs/quality-plan.md) is binding: its gates, its rules for
writing tests, and (while it lasts) its pause on new features. In short: decision logic
goes in tested `.ts` modules, not components; a bug fix starts with a failing test; never
weaken a test to make it pass; the fake isn't evidence; keep files under the limits,
splitting before adding.

## Tools

- `tools/probe/hqp.py HOST info|status|state|lists` and `tools/probe/hqp.py discover`
  are read-only, stdlib-only probes. Discovery is UDP multicast and does **not**
  cross VLANs or routed subnets.
- `npm run test:e2e` runs the browser smoke tests (Playwright) against fake HQPlayers
  (`e2e/stack.ts`, one fake per flow). First time: `npx playwright install chromium`.
  Screenshots go to `e2e/screenshots/` (git-ignored; CI uploads them as an artifact).
