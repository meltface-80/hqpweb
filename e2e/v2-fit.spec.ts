// Fit in the v2 filter sheet (fit/sheet.ts): a failure here puts that filter, and anything
// known to be no lighter, below "Won't fit as set" with why; picking one asks first; "What
// would it take?" offers the nearest changes that let it play.
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

async function openV2(page: Page, id: string) {
  await page.addInitScript((i) => {
    localStorage.setItem("instance", i);
    localStorage.setItem("prefs-v1", JSON.stringify({ layout: "v2" }));
  }, id);
  await page.goto("/");
  await expect(page.locator(".signal")).toBeVisible();
}
const shot = (page: Page, name: string) =>
  page.screenshot({ path: fileURLToPath(new URL(`screenshots/${name}.png`, import.meta.url)), fullPage: true });
const footer = (page: Page) => page.locator("footer .msg");
const open1x = (page: Page) =>
  page
    .locator(".signal")
    .getByRole("button", { name: /^1x filter/ })
    .click();
const sheet = (page: Page) => page.getByRole("dialog", { name: "1x filter: choose" });
const rowOf = (page: Page, name: string) =>
  sheet(page).locator("li.row", { has: page.getByRole("button", { name: new RegExp(`^${name}\\b`) }) });

test("v2: a failure here flags what's no lighter, asks before trying, and finds what it would take", async ({ page }) => {
  await openV2(page, "v2fit");

  // sinc-Lh can't keep up here: rolled back, and learned.
  await open1x(page);
  await sheet(page).getByRole("searchbox").fill("sinc-L");
  await sheet(page)
    .getByRole("button", { name: /^sinc-Lh\b/ })
    .click();
  await expect(footer(page)).toContainText(/rolled back/i, { timeout: 10_000 });

  // Now sinc-L (heavier) is below the line too, with why.
  await open1x(page);
  await sheet(page).getByRole("searchbox").fill("sinc-L");
  await expect(sheet(page).locator(".section").last()).toHaveText("Won't fit as set");
  await expect(rowOf(page, "sinc-Lh")).toContainText(/failed here/i);
  await expect(rowOf(page, "sinc-L")).toContainText("sinc-Lh couldn't keep up");
  await expect(rowOf(page, "sinc-L")).toContainText("eighth");
  await shot(page, "v2-fit-1-below");

  // Picking it asks first; Cancel leaves everything as it was.
  await sheet(page)
    .getByRole("button", { name: /^sinc-L\b/ })
    .click();
  const ask = sheet(page).getByRole("alertdialog", { name: "Try sinc-L anyway?" });
  await expect(ask).toContainText("Try anyway?");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);

  // What would it take, keeping the modulator: a lower rate.
  await rowOf(page, "sinc-L").getByRole("button", { name: "What would it take?" }).click();
  await rowOf(page, "sinc-L").getByLabel("modulator").check();
  const first = rowOf(page, "sinc-L").locator(".panel li").first();
  await expect(first).toContainText("DSD128 instead of DSD256");
  await shot(page, "v2-fit-2-what-it-takes");
  await first.getByRole("button", { name: "Try" }).click();

  await expect(footer(page)).toContainText("✓", { timeout: 10_000 });
  await expect(page.locator(".signal").getByRole("button", { name: /^1x filter/ })).toContainText("sinc-L");
});
