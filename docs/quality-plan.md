# Code quality plan

hqpweb is written mostly by an AI coding assistant, reviewed by a maintainer who
isn't a professional developer. That works well while a project is small. It stops
working when the code grows faster than its structure: files get too big to reason
about, tests stop proving anything, and each fix starts causing new bugs. This plan
is how we keep that from happening. It's a working document: it changes as we learn.

**Changes:**

- 2026-10-04: dropped screenshot comparison and a recorded mutation score as gates, and
  browser tests check outcomes rather than exact wording. The product is days old and
  changing fast; those gates would fail every time it changed on purpose.
- 2026-10-04, after step 1: a review of the principles. None of step 1's gates had
  caught a real bug yet; the maintainer asking "how do you know it works?" had caught
  two weak pull requests. So: principle 2 reworded, principle 8 added, the live release
  checklist moved ahead of the refactors, the `App.svelte` step narrowed, and the pause
  given an end.
- 2026-10-05: the finished refactoring plan and the "where we are" table shortened to a
  history note; the mutation-testing row says it's done by hand for now.

## History

The plan started with four steps, all done on 2026-10-04 (#17–#34):

- a safety net (browser tests, ESLint, the file-length tripwire, volume properties);
- the live release checklist;
- `App.svelte`'s logic moved into tested modules (1,471 → 509 lines);
- `instance.ts` split into a change engine and a status poller (790 → 305 lines).

New features paused until then. Since then, three more checks:

- the fake's own evidence table (#36);
- an edit-time length hook (#37);
- lint rules for tests (#38).

`npm run measure` re-measures the code.

## Principles

1. **Gates must run automatically.** A rule that only lives in a document is ignored
   in a long session. Checks run locally (pre-commit) and in CI.
2. **Gates earn their place.** Add a gate for a bug that got through, or for a bug class
   that's clearly likely here; not for its own sake. At each release, note which gates
   caught a real problem. One that has caught nothing over a few releases is
   reconsidered. (Step 1's gates were chosen up front, so they're on probation.)
3. **Decision logic lives in plain TypeScript modules with tests.** Components render;
   they don't decide.
4. **Tests prove behaviour.** A test must fail when the behaviour it describes breaks.
5. **Measured beats modelled.** The fake is a convenience; recorded HQPlayer behaviour
   and live checks are the authority.
6. **Small steps.** One concern per pull request. Refactors keep behaviour identical
   and prove it.
7. **Don't freeze the product.** Gates constrain how the code is written, not what the
   product does or looks like. A gate that fails whenever wording, layout or pixels
   change on purpose costs more than it catches while the product is young.
8. **Show the evidence.** A green CI run isn't proof. Each pull request says what it
   changes or catches, what was broken on purpose to show the tests catch it, and what
   isn't covered ([the template](../.github/pull_request_template.md)). Not a gate: a
   habit, for the reviewer.

## Gates

| Gate                                                   | Starts as                                                                                                                                                                   | Tightens to                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Browser smoke tests** (Playwright, against the fake) | 6–8 key flows. They check outcomes (what's applied, what's shown) and key phrases, not exact wording or pixels. Screenshots are saved for people to look at, never compared | A flow for each new warning that protects playback or volume |
| **ESLint**, a curated set (see below)                  | Blocking on new and changed code; old code fixed as each file is refactored                                                                                                 | Blocking everywhere                                          |
| **File length**                                        | Fails above 600 lines; reports above 400. Claude Code is warned at edit time above 500, and an edit that would cross 600 is refused                                         | Fails above 400                                              |
| **Function size and complexity**                       | Reported                                                                                                                                                                    | Fails above 60 lines or a complexity of 15                   |
| **Volume-safety properties** (fast-check)              | Volume never rises more than 6 dB in one step; rollback never raises it; undo returns to a higher level only if nobody moved it since                                       | More invariants as the change engine is split                |
| **Mutation testing**, on demand                        | Break the code on purpose and check a test fails, now and then on the core logic. By hand for now: Stryker can't drive Vitest 5 yet. No recorded score, not a gate          | —                                                            |
| **Fake contract tests**                                | The fake behaviours the safety rules rely on (stalls, rollback triggers, volume) cite a recorded reply or a measurement                                                     | Extended when a bug shows the fake was wrong                 |
| **Live release checklist**                             | Required before every release tag: a short scripted check against a real HQPlayer (see below)                                                                               | Automated where safe                                         |

**The ESLint set** targets bug classes we've actually had or are likely to: promises
nobody waits for, promises passed where they don't belong, non-exhaustive `switch`
statements, unused code, overly complex functions, and Svelte's reactivity rules.
Formatting stays with Prettier.

**The test rules** make most of "Rules for writing tests" automatic: no test without
an assertion; no unawaited, conditional, focused or skipped tests; no `toBeDefined`
(it can't fail) or snapshots; no module mocks (use a fake at the boundary); no fixed
sleeps (wait for a condition, or advance the fake's injectable clock); the fake may
not import the app's decisions; and Playwright's recommended set for browser flows.
Left out on purpose: one `expect` per test (one reason to fail isn't one `expect`) and
rules that tie browser tests to the page's structure.

**The numbers are starting values,** not measurements: 600 and 400 lines per file, 60
lines and a complexity of 15 per function. Adjust them from experience, and write down
why.

**The live release checklist** follows the project's rules for real HQPlayer instances
([CLAUDE.md](../CLAUDE.md), rule 3): reads are always fine; writes need the owner's OK,
start from a snapshot of the settings, keep the volume low (it's only ever lowered),
and end by restoring and comparing against the snapshot. It covers what no fake can:
that changes take effect, playback recovers, and the warnings appear when they should.

**Coverage** is reported per package but isn't a gate: a percentage target invites
tests written to touch lines rather than to prove behaviour. Mutation testing, run now
and then, is the check that tests prove something.

## Rules for writing tests

- **A bug fix starts with a failing test** that reproduces it.
- **Assert behaviour, not implementation:** what the user or HQPlayer sees, not which
  function was called.
- **Never weaken a test to make it pass.** If the behaviour changed on purpose, say so
  in the commit.
- **The fake isn't evidence.** A rule the fake applies is also tested against a
  recorded reply or a measurement from design §2, and labelled measured or inferred.
- **The fake never asks the app what to do.** Its rules (what stops playback, which
  filter plays a source) are its own table, with evidence cited, not calls into the
  app's code; otherwise a test of the app's predictions agrees with itself. The
  contract test checks that the app predicts every stop the fake knows.
- **One reason to fail per unit test,** with a name that says what's being checked. A
  browser test walks one flow through several steps, so it checks each step.
- **No tests that can't fail,** such as asserting that a value is merely defined.

## Trade-offs

- **Speed:** a few more minutes per CI run for browser tests.
- **Dependencies:** ESLint, Playwright and fast-check are development-only and
  never ship in the image, but they're more to keep up to date.
- **Refactoring risk:** moving code can break it. The browser tests come first for that
  reason.
- **Limits of testing:** no fake or unit test covers HQPlayer behaviour nobody has
  measured. The live release checklist is the only defence there.

## How we'll know it's working

- Bug fixes stop causing new bugs, and each bug that does get through leads to a gate
  that would have caught it.
- Gates are kept for what they catch: each release notes which ones caught something.
- No source file grows past the limits without being split first.
- Changing what the product does or looks like means updating the tests of that
  behaviour, never the gates.
