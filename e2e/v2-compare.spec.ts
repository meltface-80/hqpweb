// The v2 layout preview (docs/design-v2-layout.md): Compare: A and B heard in turn.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { expect, test } from "@playwright/test";
import { openV2, shot } from "./v2-helpers.ts";

test("v2: Compare plays A and B in turn, reads which is heard, and says what it can't offer", async ({ page }) => {
  await openV2(page, "v2compare");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Compare" });
  await expect(sheet).toContainText("Hearing A");
  await sheet.getByRole("combobox", { name: "B modulator" }).selectOption("ASDM7EC-fast");
  await expect(sheet).toContainText("quickest");
  await sheet.getByRole("button", { name: "B", exact: true }).click();
  await expect(sheet).toContainText("Hearing B", { timeout: 15_000 });
  await expect(sheet.getByRole("button", { name: "B", exact: true })).toHaveAttribute("aria-pressed", "true");
  await shot(page, "v2-8-compare");
  await sheet.getByRole("button", { name: "A", exact: true }).click();
  await expect(sheet).toContainText("Hearing A", { timeout: 15_000 });
  // PCM was never seen on this fake: B keeps the names and says why it can't offer choices.
  await sheet.getByRole("combobox", { name: "B mode" }).selectOption({ label: "PCM" });
  await expect(sheet).toContainText("hasn't seen PCM's lists");
  await expect(sheet).toContainText("pauses about 5 s");
  await sheet.getByRole("button", { name: "Keep A" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".signal").getByRole("button", { name: /^Modulator/ })).toContainText("AHM7EC8B");
});
