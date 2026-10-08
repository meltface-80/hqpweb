// The v2 layout preview (docs/design-v2-layout.md): the signal-path card with the mode as
// tabs, auto explaining itself, switching mode through a sheet, and History.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
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
