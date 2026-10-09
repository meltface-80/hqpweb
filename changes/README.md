# Change notes

One file per change, so pull requests don't all edit the top of `CHANGELOG.md`. A release
gathers them into a new version section and deletes them (`tools/release/changes.ts`).

- **Name:** `added.<slug>.md`, `changed.<slug>.md` or `fixed.<slug>.md`, e.g.
  `fixed.history-settle.md`. The prefix is the changelog section.
- **Content:** one or more list items, written as they should read in the changelog: a
  bold lead, then what changed for the listener.
- **Preview:** `node tools/release/changes.ts preview`.
