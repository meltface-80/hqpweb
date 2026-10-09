// The v2 layout preview (docs/design-v2-layout.md): the chip pickers: filters, the apodization notice, modulators.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { expect, test } from "@playwright/test";
import { openV2, shot } from "./v2-helpers.ts";

test("v2: filter sheets carry chips, narrow by them, and pick", async ({ page }) => {
  await openV2(page, "v2filters");
  await page
    .locator(".signal")
    .getByRole("button", { name: /^1x filter/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "1x filter: choose" });
  await expect(sheet).toBeVisible();
  const count = sheet.locator(".count");
  const all = await count.textContent();
  // The filter in use carries "in use"; rows carry facts such as their phase.
  await expect(sheet.locator(".row.current")).toContainText("in use");
  await expect(sheet).toContainText("linear phase");
  // A chip narrows the list, and the count follows.
  await sheet.getByRole("combobox", { name: "Apodizing" }).selectOption({ label: "apodizing" });
  await expect(count).not.toHaveText(all!);
  // Chips and drop-downs are one height. A guard only: iOS draws selects shorter, and
  // neither Chromium nor desktop WebKit reproduces that, so the fix itself is checked by eye.
  const bar = sheet.getByRole("group", { name: "Show only" });
  const chipH = (await bar.getByRole("button").first().boundingBox())!.height;
  const selH = (await bar.getByRole("combobox").first().boundingBox())!.height;
  expect(Math.abs(chipH - selH)).toBeLessThan(1);
  // Families are drop-downs: one phase at a time.
  const narrowed = await count.textContent();
  await sheet.getByRole("combobox", { name: "Phase" }).selectOption({ label: "minimum phase" });
  await expect(count).not.toHaveText(narrowed!);
  await expect(sheet.locator(".row").first()).toContainText("minimum phase");
  await sheet.getByRole("combobox", { name: "Phase" }).selectOption({ label: "Phase: any" });
  await expect(count).toHaveText(narrowed!);
  await shot(page, "v2-6-filter-sheet");
  await sheet.getByRole("button", { name: /^IIR\b/ }).click();
  await expect(page.locator(".signal").getByRole("button", { name: /^1x filter/ })).toContainText("IIR");
});

test("v2: the apodization notice opens the new filter sheet, narrowed to apodizing", async ({ page }) => {
  await openV2(page, "v2apod");
  await page
    .locator("p", { hasText: /apodization/ })
    .getByRole("button")
    .click();
  const sheet = page.getByRole("dialog", { name: "1x filter: choose" });
  await expect(sheet.getByRole("combobox", { name: "Apodizing" })).toHaveValue("apod:apodizing");
  await expect(sheet.getByRole("button", { name: /^poly-sinc-hb\b/ })).toHaveCount(0);
});

test("v2: the modulator list carries chips, narrows by order and load, and picks", async ({ page }) => {
  await openV2(page, "v2shaper");
  await page
    .locator(".signal")
    .getByRole("button", { name: /^Modulator/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "Modulator" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".row.current")).toContainText("in use");
  await expect(sheet).toContainText("Newest EC line");
  const count = sheet.locator(".count");
  await expect(count).toHaveText(/^36 of 36$/);
  await sheet.getByRole("combobox", { name: "Order" }).selectOption({ label: "fifth order" });
  await sheet.getByRole("combobox", { name: "Load in its line" }).selectOption({ label: "EC line: heaviest" });
  await expect(sheet).toContainText("needs a fast CPU at this rate");
  await expect(count).toHaveText(/^2 of 36$/);
  await shot(page, "v2-7-modulator-sheet");
  await sheet.getByRole("button", { name: "ASDM5EC-super", exact: true }).click();
  await expect(page.locator(".signal").getByRole("button", { name: /^Modulator/ })).toContainText("ASDM5EC-super");
});
