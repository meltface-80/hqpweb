// Shared by the v2 layout's specs: open an instance in the v2 layout, and screenshot.
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

export async function openV2(page: Page, id: string) {
  await page.addInitScript((i) => {
    localStorage.setItem("instance", i);
    localStorage.setItem("prefs-v1", JSON.stringify({ layout: "v2" }));
  }, id);
  await page.goto("/");
  await expect(page.locator(".signal")).toBeVisible();
}

export const shot = (page: Page, name: string) =>
  page.screenshot({ path: fileURLToPath(new URL(`screenshots/${name}.png`, import.meta.url)), fullPage: true });
