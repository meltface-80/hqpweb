import { expect, it } from "vitest";
import { offerReload } from "./update.ts";

it("offers a reload when the server runs a different commit than the page was built from", () => {
  expect(offerReload("abc1234", "def5678", false)).toBe(true);
});

it("doesn't when they match, when the server doesn't say, or in development", () => {
  expect(offerReload("abc1234", "abc1234", false)).toBe(false);
  expect(offerReload("abc1234", undefined, false)).toBe(false);
  expect(offerReload("", "def5678", false)).toBe(false);
  expect(offerReload("abc1234", "def5678", true)).toBe(false);
});
