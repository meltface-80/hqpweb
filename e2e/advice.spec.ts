// Browser tests for the modulator / dither sheet: the grouped list and the guides.
// Same rules as smoke.spec.ts: one instance per test (they run in parallel), outcomes
// and short key phrases only. What the guide suggests is advice/*.test.ts's job; here
// we check the screen asks, saves, and applies what the engine said.
import { expect, test, type Page } from "@playwright/test";
import { fakeUrl, shotPath } from "./hosts.ts";

/** Open on an instance. */
async function openOn(page: Page, id: string) {
  await page.addInitScript((i) => localStorage.setItem("instance", i), id);
  await page.goto("/");
  await expect(page.locator("section.now")).toBeVisible();
}
const shot = (page: Page, name: string) => page.screenshot({ path: shotPath(name), fullPage: true });
const row = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}`) });
const sheet = (page: Page) => page.locator("dialog[open]");
/** Change a fake's state, as HQPlayer or its owner would. */
async function poke(id: string, body: object) {
  const r = await fetch(fakeUrl(id), { method: "POST", body: JSON.stringify(body) });
  expect(r.status).toBe(204);
}

test("a rate the modulator can't play at, or a modulator the rate can't take, offers the pair", async ({ page }) => {
  await openOn(page, "pairnet");
  await expect(row(page, "Modulator")).toContainText("AHM7EC8B");

  // Advanced: DSD256 with AHM can't play, so the rate goes with ASDM7EC-fast, as one change.
  await page.locator("summary", { hasText: "Advanced" }).click();
  await row(page, "Rate").click();
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await sheet(page)
    .getByRole("button", { name: /^DSD256/ })
    .click();
  await expect(row(page, "Modulator")).toContainText("ASDM7EC-fast");
  await expect(row(page, "Rate")).toContainText("DSD256");
  expect(asked).toContain("together");

  // The List: AHM at DSD256 can't play, so picking it offers DSD1024 with it.
  await row(page, "Modulator").click();
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await sheet(page)
    .getByRole("button", { name: /^AHM7EC8B/ })
    .click();
  await expect(row(page, "Rate")).toContainText("DSD1024");
  await expect(row(page, "Modulator")).toContainText("AHM7EC8B");
  expect(asked).toContain("DSD1024");
});

test("HQPlayer that stops answering gets restart steps", async ({ page }) => {
  await openOn(page, "down");
  await poke("down", { down: true });
  const banner = page.locator(".banner", { hasText: /unreachable/ });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await banner.locator("summary").click();
  await expect(banner).toContainText("Quit HQPlayer");
  await expect(banner).toContainText("saved settings");
  // What's shown is HQPlayer's last known state: dimmed, and nothing in it can be pressed.
  await expect(page.locator("div.live")).toHaveAttribute("inert", "");
  await shot(page, "advice-5-down");
});
