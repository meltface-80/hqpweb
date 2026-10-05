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
| **File length**                                        | Fails above 600 lines; reports above 400                                                                                                                                    | Fails above 400                                              |
| **Function size and complexity**                       | Reported                                                                                                                                                                    | Fails above 60 lines or a complexity of 15                   |
| **Volume-safety properties** (fast-check)              | Volume never rises more than 6 dB in one step; rollback never raises it; undo returns to a higher level only if nobody moved it since                                       | More invariants as the change engine is split                |
| **Mutation testing** (Stryker), on demand              | Run now and then on the core logic, to find tests that can't fail. No recorded score, not a gate                                                                            | —                                                            |
| **Fake contract tests**                                | The fake behaviours the safety rules rely on (stalls, rollback triggers, volume) cite a recorded reply or a measurement                                                     | Extended when a bug shows the fake was wrong                 |
| **Live release checklist**                             | Required before every release tag: a short scripted check against a real HQPlayer (see below)                                                                               | Automated where safe                                         |

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

## Refactoring plan

Each step keeps behaviour identical, shown by the browser smoke tests staying green. A
refactor's pull request can include before-and-after screenshots for review; they're a
one-off check, not a stored baseline.

1. **Safety net.** Browser smoke tests, the curated ESLint set, the file-length
   tripwire, the volume-safety properties, and a command that re-measures the table
   above. _Done when_ the smoke flows run in CI, ESLint and the length tripwire block
   on changed code, and the volume properties pass. _Done 2026-10-04_ (#17–#20, and a
   pre-commit hook that runs the fast checks).
2. **Live release checklist.** A short, scripted check against a real HQPlayer, before
   each release tag (see the gate above). It comes before the refactors because
   measuring real instances has found every real behaviour bug so far, and the fake
   can't. _Done when_ it has run once against a real instance, including the volume
   rule from #20 (a rollback keeps the volume low). _Done 2026-10-04_ (#24, #25: it found
   a real bug on its first run, the first gate to do so).
3. **`App.svelte`: logic first.** Move decision logic into tested modules under
   `apps/web/src/lib/` (filter and rate hints, the "won't start" check, the update
   check): it outlives any redesign. Split the view into components only as far as it
   takes to get under the file limits; leave further structure until the UI settles.
   _Done when_ no UI file exceeds the limits, the moved logic has tests, and the smoke
   flows pass. _Done 2026-10-04_ (#28, #29, #30: App.svelte 1,471 → 509 lines).
4. **`instance.ts`.** Split into a change engine and a status poller behind a thin
   facade. Add the fake's contract tests. _Done when_ no server file exceeds the
   limits and the fake's safety-relevant behaviours cite evidence. _Done 2026-10-04_
   (#32, #33, #34: instance.ts 790 → 305 lines; no file in the repo over 600).

New features pause until steps 2–4 are done as written here, and no longer: work that
grows beyond these descriptions waits until after the pause. _All four steps were done on
2026-10-04, so the pause is over._ Bug fixes continue, each
starting with a failing test.

## Trade-offs

- **Speed:** a short pause on features, and a few more minutes per CI run for browser
  tests.
- **Dependencies:** ESLint, Playwright and fast-check (and Stryker, when it's run) are development-only and
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
