// Shared by the layout's specs: open an instance, and screenshot.
import { expect, type Page } from "@playwright/test";
import { shotPath } from "./hosts.ts";

export async function openV2(page: Page, id: string) {
  await page.addInitScript((i) => {
    localStorage.setItem("instance", i);
  }, id);
  await page.goto("/");
  await expect(page.locator(".signal")).toBeVisible();
}

export const shot = (page: Page, name: string) => page.screenshot({ path: shotPath(name), fullPage: true });
