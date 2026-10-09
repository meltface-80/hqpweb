// The v2 layout preview (docs/design-v2-layout.md): the signal-path card: the mode as tabs, the other mode as last seen, switching mode, auto explaining itself, and the mini bar.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { expect, test } from "@playwright/test";
import { openV2, shot } from "./v2-helpers.ts";

test("v2: the signal card, the other mode as last seen, switching mode, and History", async ({ page }) => {
  await openV2(page, "v2");
  const card = page.locator(".signal");

  // The path line and the mode as tabs.
  await expect(card.getByLabel("Signal path now")).toContainText("gauss-xla");
  await expect(card.getByRole("tab", { name: /DSD/ })).toHaveAttribute("aria-selected", "true");
  await expect(card.getByRole("button", { name: "Guide me" })).toBeVisible();
  await shot(page, "v2-1-card");

  // PCM, not in use: its settings aren't known yet here, and it offers the switch.
  await card.getByRole("tab", { name: "PCM" }).click();
  await expect(card).toContainText("Not in use");
  await card.getByRole("button", { name: "Switch to PCM" }).click();
  const sheet = page.getByRole("dialog", { name: "Switch to PCM" });
  await expect(sheet).toContainText("always pauses first");
  await sheet.getByRole("button", { name: "Switch", exact: true }).click();
  // In PCM now: the tab says so, and the shaping row is the dither.
  await expect(card.getByRole("tab", { name: /PCM.*in use/ })).toHaveAttribute("aria-selected", "true");
  await expect(card.getByRole("button", { name: /^Dither/ })).toBeVisible();

  // DSD is now the other tab, as last seen.
  await card.getByRole("tab", { name: "DSD" }).click();
  await expect(card).toContainText("Last seen in DSD");
  await expect(card).toContainText("AHM7EC8B");
  await shot(page, "v2-2-dsd-last-seen");

  // Back to DSD: its last rate was auto (the highest in DSD), so the sheet asks for one.
  await card.getByRole("button", { name: "Switch to DSD" }).click();
  const back = page.getByRole("dialog", { name: "Switch to DSD" });
  await expect(back).toContainText("At which rate");
  await back.getByRole("button", { name: "DSD256" }).click();
  await back.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(card.getByRole("tab", { name: /DSD.*in use/ })).toBeVisible();
  await expect(card.getByRole("button", { name: /^Rate/ })).toContainText("DSD256");

  // History has the switch.
  await page.getByRole("button", { name: "History" }).click();
  const history = page.getByRole("dialog", { name: "History" });
  await expect(history).toContainText("Mode → PCM");
  await shot(page, "v2-3-history");
});

test("v2: auto explains itself in PCM", async ({ page }) => {
  await openV2(page, "v2auto");
  await page.locator(".signal").getByRole("tab", { name: "PCM" }).click();
  await page.getByRole("button", { name: "Switch to PCM" }).click();
  await page.getByRole("dialog", { name: "Switch to PCM" }).getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.locator(".signal .auto")).toContainText("highest rate this filter can use");
});

test("v2: the mini bar takes over when the now card scrolls away", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openV2(page, "v2mini");
  const mini = page.getByRole("region", { name: "Now playing, compact" });
  await expect(mini).toHaveCount(0);
  // A filter change brings up the footer (its result); a volume change alone is quiet.
  await page
    .locator(".signal")
    .getByRole("button", { name: /^1x filter/ })
    .click();
  await page
    .getByRole("dialog", { name: "1x filter: choose" })
    .getByRole("button", { name: /^IIR\b/ })
    .click();
  const footer = page.locator("footer");
  await expect(footer).toContainText("IIR");
  await page.getByRole("button", { name: "History" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 2000);
  await expect(mini).toBeVisible();
  await expect(mini).toContainText("keeping up");
  await mini.getByRole("button", { name: /^Down/ }).click();
  await expect(mini).toContainText("-23");
  // It sits above the footer (the filter change's result), not over it.
  // Both slide (0.4 s): once the footer is fully on screen, the bar must be above it.
  await expect
    .poll(async () => {
      const [m, f, vh] = [await mini.boundingBox(), await footer.boundingBox(), await page.evaluate(() => innerHeight)];
      return f!.y + f!.height <= vh + 1 && m!.y + m!.height <= f!.y + 1;
    })
    .toBe(true);
  await shot(page, "v2-4-mini-bar");
  await mini.getByRole("button", { name: "Back to now playing" }).click();
  await expect(mini).toHaveCount(0);
});
