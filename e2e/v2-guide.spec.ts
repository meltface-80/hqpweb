// The v2 layout preview (docs/design-v2-layout.md): Guide me as a flow.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { expect, test } from "@playwright/test";
import { openV2, shot } from "./v2-helpers.ts";

test("v2: Guide me is a flow, one question at a time, ending where to start", async ({ page }) => {
  await openV2(page, "v2guide");
  await page.locator(".signal").getByRole("button", { name: "Guide me" }).click();
  const guide = page.getByRole("dialog", { name: "Guide" });
  await expect(guide).toContainText("1 of 4");
  await expect(guide).not.toContainText("Rate and modulator"); // one step at a time
  const next = guide.getByRole("button", { name: "Next" });
  await expect(next).toBeDisabled();
  await guide.getByRole("button", { name: /^DSD goes straight to the converter/ }).click();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(guide).toContainText("2 of 4");
  await guide.getByRole("button", { name: /^No\b/ }).click();
  await next.click();
  await guide.getByRole("button", { name: /^No\b/ }).click();
  await next.click();
  await expect(guide).toContainText("4 of 4");
  await expect(guide).toContainText("Rate and modulator");
  await shot(page, "v2-9-guide");
  await guide.getByRole("button", { name: "Back" }).click();
  await expect(guide).toContainText("3 of 4");
  await guide.getByRole("button", { name: "Exit guide" }).click();
  await expect(guide).toBeHidden();
  // Opened again, it starts where it left off: every question answered, so where to start.
  await page.locator(".signal").getByRole("button", { name: "Guide me" }).click();
  await expect(guide).toContainText("4 of 4");
});
