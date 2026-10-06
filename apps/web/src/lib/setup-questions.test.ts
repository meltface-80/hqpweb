import { describe, expect, it } from "vitest";
import { SETUP_ANSWERS } from "./setup-answers.ts";
import { savedMessage, SETUP_QUESTION_LIST } from "./setup-questions.ts";

// A missing or unknown answer in setup-questions.ts is a type error (npm run check -w
// apps/web); these check what the types can't: order, duplicates, empty text.

describe("Setup questions: in step with the answers the server allows", () => {
  it("asks every question there is, once, under its own key", () => {
    const keys = SETUP_QUESTION_LIST.map((q) => q.key);
    expect([...keys].sort()).toEqual(Object.keys(SETUP_ANSWERS).sort());
  });

  it("offers exactly the allowed answers, each once, in the allowed order", () => {
    const offered = Object.fromEntries(SETUP_QUESTION_LIST.map((q) => [q.key, q.options.map((o) => o.value)]));
    expect(offered).toEqual(SETUP_ANSWERS);
  });

  it("gives every answer a label and a description", () => {
    const bare = SETUP_QUESTION_LIST.flatMap((q) => q.options.filter((o) => !o.label || !o.description).map((o) => o.value));
    expect(bare).toEqual([]);
  });
});

describe("Setup questions: saying it's saved", () => {
  it("says the instance itself was saved when it had only been discovered", () => {
    expect(savedMessage(true)).toContain("now saved in Settings");
  });

  it("says only 'Saved.' for an instance that was already saved", () => {
    expect(savedMessage(false)).toBe("Saved.");
  });
});
