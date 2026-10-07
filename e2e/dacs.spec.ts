// Named DACs behind one HQPlayer (server: dac-scope.ts): name them in Settings, pick the
// one in use there or in the header, and the setup answers and presets follow the choice.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

async function openOn(page: Page, id: string) {
  await page.addInitScript((i) => localStorage.setItem("instance", i), id);
  await page.goto("/");
  await expect(page.locator("section.now")).toBeVisible();
}
const shot = (page: Page, name: string) =>
  page.screenshot({ path: fileURLToPath(new URL(`screenshots/${name}.png`, import.meta.url)), fullPage: true });
const sheet = (page: Page) => page.locator("dialog[open]");

test("named DACs: add one, answers follow the DAC in use, switch in Settings or the header", async ({ page }) => {
  await openOn(page, "dacs");
  const settings = () => page.getByRole("button", { name: "Settings" }).click();
  const dsd = sheet(page).getByRole("radiogroup", { name: "How your DAC takes DSD" });
  const direct = dsd.getByRole("radio", { name: /straight to the converter/ });

  // No picker with one DAC.
  await expect(page.getByRole("combobox", { name: "DAC in use" })).toHaveCount(0);

  // Add a second DAC; the first is named on the way.
  await settings();
  await sheet(page).getByRole("textbox", { name: "New DAC's name" }).fill("Desk");
  page.once("dialog", (d) => void d.accept("Holo"));
  await sheet(page).getByRole("button", { name: "Add a DAC" }).click();
  await expect(sheet(page).locator(".dacs li")).toHaveCount(2);
  await expect(sheet(page).locator(".dacs li.now")).toContainText("Holo");

  // Answers for Holo (in use), then Desk starts with none.
  await direct.check();
  await expect(dsd).toContainText("Saved");
  await sheet(page).locator(".dacs li", { hasText: "Desk" }).getByRole("button", { name: "Use" }).click();
  await expect(sheet(page).locator(".dacs li.now")).toContainText("Desk");
  await expect(dsd.getByRole("radio", { name: /^Not set/ })).toBeChecked();
  await shot(page, "dacs-1-settings");
  await sheet(page).getByRole("button", { name: "Close" }).click();

  // The header picker, back to Holo: its answers are there again.
  const picker = page.getByRole("combobox", { name: "DAC in use" });
  await expect(picker).toHaveValue("desk");
  await picker.selectOption({ label: "Holo" });
  await expect(picker).toHaveValue("main");
  await settings();
  await expect(direct).toBeChecked();
  await sheet(page).getByRole("button", { name: "Close" }).click();

  // A preset saved for Holo only isn't offered once Desk is in use.
  await page.getByRole("button", { name: /^Presets/ }).click();
  await sheet(page).getByRole("textbox", { name: "Preset name" }).fill("Holo ref");
  await sheet(page).getByRole("button", { name: "Save" }).click();
  await expect(sheet(page).getByText("Holo ref")).toBeVisible();
  await expect(sheet(page).locator(".daconly")).toHaveCount(1);
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await picker.selectOption({ label: "Desk" });
  await expect(picker).toHaveValue("desk");
  await page.getByRole("button", { name: /^Presets/ }).click();
  await expect(sheet(page).getByText("Holo ref")).toHaveCount(0);
});
