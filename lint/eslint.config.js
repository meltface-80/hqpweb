// The curated ESLint set (docs/quality-plan.md, "The ESLint set"): bug classes we've
// had or are likely to have. Formatting stays with Prettier.
//
// Lives in lint/ with its own TypeScript 6.0, because typescript-eslint doesn't
// support TypeScript 7 yet. Run from the repo root: npm run lint.
//
// Existing violations are recorded in lint/eslint-suppressions.json: they don't fail,
// new ones do. Fix them as each file is refactored, then `npm run lint -- --prune-suppressions`.
import vitest from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      ".tsbuild/",
      "lint/",
      "tools/*/",
      "!tools/quality/",
      "!tools/release-check/",
      "e2e/test-results/",
      "e2e/report/",
    ],
  },
  {
    files: ["**/*.ts", "**/*.svelte"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Root-level files that no tsconfig includes (test/ has its own).
        projectService: { allowDefaultProject: ["vitest.config.ts"] },
        tsconfigRootDir: root,
        extraFileExtensions: [".svelte"],
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    // No eslint-disable comments: an exception goes in this file, where review sees it.
    linterOptions: { noInlineConfig: true },
    rules: {
      // Promises nobody waits for: errors vanish and ordering breaks.
      "@typescript-eslint/no-floating-promises": "error",
      // Promises passed where they don't belong (an async handler where a plain one is expected).
      "@typescript-eslint/no-misused-promises": "error",
      // A new mode, state or field that a switch silently ignores. A `default:` doesn't
      // count as handling it: that's how a new case gets swallowed.
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: false }],
      // Unused code. A leading _ marks a deliberately unused argument.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      // Reported, not yet blocking (the plan: fails above 60 lines or a complexity of 15, later).
      complexity: ["warn", 15],
      "max-lines-per-function": ["warn", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  // The fake never asks the app what to do (docs/quality-plan.md, "Rules for writing
  // tests"): otherwise a test of the app's predictions agrees with itself.
  {
    files: ["packages/fake-hqp/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@app/protocol",
              importNames: [
                "predictedStop",
                "filterSlot",
                "ratioHint",
                "ratioClass",
                "modulatorHint",
                "ditherHint",
                "compatibleRates",
                "isApodizing",
                "filterNotes",
                "modulatorGen",
              ],
              message: "The fake must not ask the app what to do: give it its own rule, citing the evidence (see stops.ts).",
            },
          ],
        },
      ],
    },
  },
  // Unit tests that can't fail, or can't fail reliably ("Rules for writing tests").
  {
    files: ["**/*.test.ts"],
    plugins: { vitest },
    rules: {
      // A test with no assertion passes whatever the code does.
      "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "fc.assert", "until"] }],
      // An unawaited or conditional expect may never run.
      "vitest/valid-expect": "error",
      "vitest/no-conditional-expect": "error",
      // A forgotten .only or .skip silently stops other tests running.
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
      // "Merely defined" passes for any value; snapshots re-assert the code at itself.
      "vitest/no-restricted-matchers": [
        "error",
        {
          toBeDefined: "This can't fail for any value: assert the value itself.",
          "not.toBeUndefined": "This can't fail for any value: assert the value itself.",
          toMatchSnapshot: "No snapshots: assert the fields that matter.",
          toMatchInlineSnapshot: "No snapshots: assert the fields that matter.",
        },
      ],
      // A module mock tests the stand-in. Use a fake at the boundary (the fake HQPlayer).
      "vitest/no-restricted-vi-methods": [
        "error",
        { mock: "Use a fake at the boundary instead.", doMock: "Use a fake at the boundary instead." },
      ],
      // A fixed sleep tests how fast the machine is. Wait for a condition (a polling loop
      // is fine) or advance an injected clock, as the fake's `now` option allows.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='setTimeout']:not(:matches(WhileStatement, ForStatement, DoWhileStatement) CallExpression)",
          message: "A fixed sleep: wait for a condition, or advance an injected clock.",
        },
      ],
    },
  },
  // Browser flows: Playwright's recommended set (no fixed waits, awaited expects, …).
  {
    files: ["e2e/**/*.ts"],
    plugins: playwright.configs["flat/recommended"].plugins,
    rules: playwright.configs["flat/recommended"].rules,
  },
  // Svelte's own correctness and reactivity rules.
  ...svelte.configs.recommended,
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: tseslint.parser, projectService: true, extraFileExtensions: [".svelte"] } },
  },
);
