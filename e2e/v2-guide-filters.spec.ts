// The guide's last step hands over to the filters: "Filters →" closes the guide and
// opens the filter sheet for the slot in use (guide-flow.ts FILTER_HANDOFF).
import { expect, test } from "@playwright/test";
import { openV2, shot } from "./v2-helpers.ts";

test("v2: the guide ends with Filters →, which opens the filter sheet in use", async ({ page }) => {
  await openV2(page, "v2guidefilters");
  await page.locator(".signal").getByRole("button", { name: "Guide me" }).click();
  const guide = page.getByRole("dialog", { name: "Guide" });
  const next = guide.getByRole("button", { name: "Next" });
  await guide.getByRole("button", { name: /^DSD goes straight to the converter/ }).click();
  await next.click();
  await expect(guide.getByRole("button", { name: "Filters →" })).toHaveCount(0); // only at the end
  await guide.getByRole("button", { name: /^No\b/ }).click();
  await next.click();
  await guide.getByRole("button", { name: /^No\b/ }).click();
  await next.click();
  await expect(guide).toContainText("4 of 4");
  await expect(guide).toContainText("up to your ears");
  await shot(page, "v2-guide-filters");
  await guide.getByRole("button", { name: "Filters →" }).click();
  await expect(guide).toBeHidden();
  await expect(page.getByRole("dialog", { name: "1x filter: choose" })).toBeVisible();
});
