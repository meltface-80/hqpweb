# Code quality plan

hqpweb is written mostly by an AI coding assistant, reviewed by a maintainer who
isn't a professional developer. That works well while a project is small. It stops
working when the code grows faster than its structure: files get too big to reason
about, tests stop proving anything, and each fix starts causing new bugs. This plan
is how we keep that from happening. It's a working document: it changes as we learn.

## Where we are (0.1.0-beta.1)

| Area                | Source lines | Tests                | Notes                                                                                   |
| ------------------- | -----------: | -------------------- | --------------------------------------------------------------------------------------- |
| `apps/web` (UI)     |        3,852 | none                 | `App.svelte` is 1,471 lines (622 script, 382 markup, 467 styles) holding most UI logic. |
| `apps/server`       |        2,921 | 1,736 lines, 8 files | `instance.ts` is 897 lines and does six jobs (changes, polling, transport, presets, …). |
| `packages/protocol` |        1,340 | 460 lines, 3 files   | Mostly pure functions; the best-tested part.                                            |
| `packages/fake-hqp` |        1,011 | 194 lines            | The fake HQPlayer used by tests.                                                        |

Re-measure with `npm run measure`. It also counts config files, so `apps/web` shows
25 lines more (`vite.config.ts`) than the 3,852 above.

Already enforced in CI: strict TypeScript (including `noUncheckedIndexedAccess`),
`svelte-check` with warnings as errors, Prettier, unit and integration tests, a Docker
build with a health check, and CodeQL. **Missing:** a linter, any limit on file or
function size, coverage measurement, and any UI tests.

Two problems that line counts don't show:

- **The UI's decision logic is untested.** Which filters are blocked, which rates
  fit, when a warning banner appears: all of it sits in `App.svelte`, checked only by
  looking at screenshots.
- **The fake can agree with us by construction.** It decides "won't play" using our
  own rules module, so some tests check that our rules agree with themselves. The real
  ground truth is the measurements in [design-v1.md](design-v1.md) §2; every real
  behaviour bug found so far was caught by measuring a real instance, not by the fake.

## Principles

1. **Gates must run automatically.** A rule that only lives in a document is ignored
   in a long session. Checks run locally (pre-commit) and in CI.
2. **Choose gates from real bugs.** When a bug gets through, ask which gate should have
   caught it, and add that one. Don't add gates for their own sake.
3. **Decision logic lives in plain TypeScript modules with tests.** Components render;
   they don't decide.
4. **Tests prove behaviour.** A test must fail when the behaviour it describes breaks.
5. **Measured beats modelled.** The fake is a convenience; recorded HQPlayer behaviour
   and live checks are the authority.
6. **Small steps.** One concern per pull request. Refactors keep behaviour identical
   and prove it.

## Gates

| Gate                                                   | Starts as                                                                                     | Tightens to                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Browser smoke tests** (Playwright, against the fake) | 6–8 key flows, with screenshots                                                               | A flow added for every new screen or warning  |
| **ESLint**, a curated set (see below)                  | Blocking on new and changed code; old code fixed as each file is refactored                   | Blocking everywhere                           |
| **File length**                                        | Fails above 600 lines; reports above 400                                                      | Fails above 400                               |
| **Function size and complexity**                       | Reported                                                                                      | Fails above 60 lines or a complexity of 15    |
| **Volume-safety properties** (fast-check)              | Volume never rises more than 6 dB in one step; undo and rollback never raise it               | More invariants as the change engine is split |
| **Mutation testing** (Stryker), on demand              | A baseline score recorded for the ratio rules and the change engine                           | The score never drops below that baseline     |
| **Fake contract tests**                                | Each fake behaviour that matters is checked against a recorded reply or a cited measurement   | Unlabelled fake behaviour isn't allowed       |
| **Live release checklist**                             | Required before every release tag: a short scripted check against a real HQPlayer (see below) | Automated where safe                          |

**The ESLint set** targets bug classes we've actually had or are likely to: promises
nobody waits for, promises passed where they don't belong, non-exhaustive `switch`
statements, unused code, overly complex functions, and Svelte's reactivity rules.
Formatting stays with Prettier.

**The numbers are starting values,** not measurements: 600 and 400 lines per file, 60
lines and a complexity of 15 per function. Adjust them from experience, and write down
why.

**The live release checklist** follows the project's rules for real HQPlayer instances
([CLAUDE.md](../CLAUDE.md), rule 3): reads are always fine; writes need the owner's OK,
start from a snapshot of the settings, keep the volume low (it's only ever lowered),
and end by restoring and comparing against the snapshot. It covers what no fake can:
that changes take effect, playback recovers, and the warnings appear when they should.

**Coverage** is reported per package but isn't a gate: a percentage target invites
tests written to touch lines rather than to prove behaviour. Mutation testing is the
check that tests prove something.

## Rules for writing tests

- **A bug fix starts with a failing test** that reproduces it.
- **Assert behaviour, not implementation:** what the user or HQPlayer sees, not which
  function was called.
- **Never weaken a test to make it pass.** If the behaviour changed on purpose, say so
  in the commit.
- **The fake isn't evidence.** A rule the fake applies is also tested against a
  recorded reply or a measurement from design §2, and labelled measured or inferred.
- **One reason to fail per test,** with a name that says what's being checked.
- **No tests that can't fail,** such as asserting that a value is merely defined.

## Refactoring plan

Each step keeps behaviour identical, shown by the browser smoke tests staying green and
by screenshot differences a non-developer can review.

1. **Safety net.** Browser smoke tests, the curated ESLint set, the file-length
   tripwire, the volume-safety properties, and a command that re-measures the table
   above. _Done when_ the smoke flows run in CI, ESLint and the length tripwire block
   on changed code, and the volume properties pass.
2. **`App.svelte`.** Move decision logic into tested modules under `apps/web/src/lib/`
   (filter and rate hints, the "won't start" check, the update check). Split the view
   into components: the Now card, warning banners, the filters card, Advanced, and the
   transport. Picker and the rate sheet share one sheet component. _Done when_ no UI
   file exceeds the limits, the moved logic has tests, the smoke flows and screenshots
   are unchanged, and a mutation baseline is recorded for the moved logic.
3. **`instance.ts`.** Split into a change engine and a status poller behind a thin
   facade. Add the fake's contract tests and the live release checklist. _Done when_
   no server file exceeds the limits, the fake's important behaviours cite evidence,
   the checklist has run once against a real instance, and a mutation baseline is
   recorded for the change engine.

New features pause until all three steps are done, a few working sessions in all.
Bug fixes continue, each starting with a failing test.

## Trade-offs

- **Speed:** a short pause on features, and a few more minutes per CI run for browser
  tests.
- **Dependencies:** ESLint, Playwright, Stryker and fast-check are development-only and
  never ship in the image, but they're more to keep up to date.
- **Refactoring risk:** moving code can break it. The browser tests come first for that
  reason.
- **Limits of testing:** no fake or unit test covers HQPlayer behaviour nobody has
  measured. The live release checklist is the only defence there.

## How we'll know it's working

- Bug fixes stop causing new bugs, and each bug that does get through leads to a gate
  that would have caught it.
- No source file grows past the limits without being split first.
- Mutation scores on the core logic never fall below their baselines.
