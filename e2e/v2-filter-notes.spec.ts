// The (i) notes on filters (advice/filter-notes.ts), in the v2 filter sheet: one per filter,
// cited, and one on the sheet's title for the two slots.
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

test("v2: each filter has an (i) with a cited note, and the title explains the two slots", async ({ page }) => {
  await openV2(page, "v2filters");
  await page
    .locator(".signal")
    .getByRole("button", { name: /^1x filter/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "1x filter: choose" });
  await sheet.getByRole("button", { name: "About poly-sinc-gauss-long" }).click();
  const note = sheet.locator(".note");
  await expect(note).toContainText("default 1x filter");
  await expect(note).toContainText("HQPlayer 6 help");
  await expect(note.getByRole("link", { name: /Jussi, / }).first()).toHaveAttribute("href", /community\.roonlabs\.com/);
  await shot(page, "v2-6b-filter-note");
  await sheet.getByRole("button", { name: "About poly-sinc-gauss-long" }).click();
  await expect(note).toHaveCount(0);
  await sheet.getByRole("button", { name: "About the 1x and Nx filters" }).click();
  await expect(sheet.locator(".note")).toContainText("two filter slots");
});
