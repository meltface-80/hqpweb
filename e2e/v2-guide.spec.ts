// The layout (docs/design-v2-layout.md): Guide me as a flow, its rate-and-modulator pairs, a DAC
// that converts DSD, and the falling-behind alarm.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { expect, test, type Page } from "@playwright/test";
import { openV2, shot } from "./v2-helpers.ts";

test("v2: Guide me is a flow, one question at a time, ending where to start", async ({ page }) => {
  await openV2(page, "v2guide");
  await page.locator(".signal").getByRole("button", { name: "Guide me" }).click();
  const guide = page.getByRole("dialog", { name: "Guide" });
  await expect(guide).toContainText("1 of 4");
  await expect(guide).not.toContainText("Rate and modulator"); // one step at a time
  const next = guide.getByRole("button", { name: "Next" });
  await expect(next).toBeDisabled();
  await guide.getByRole("button", { name: /^DSD goes straight to the converter/ }).click();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(guide).toContainText("2 of 4");
  await guide.getByRole("button", { name: /^No\b/ }).click();
  await next.click();
  await guide.getByRole("button", { name: /^No\b/ }).click();
  await next.click();
  await expect(guide).toContainText("4 of 4");
  await expect(guide).toContainText("Rate and modulator");
  await shot(page, "v2-9-guide");
  await guide.getByRole("button", { name: "Back" }).click();
  await expect(guide).toContainText("3 of 4");
  await guide.getByRole("button", { name: "Exit guide" }).click();
  await expect(guide).toBeHidden();
  // Opened again, it starts where it left off: every question answered, so where to start.
  await page.locator(".signal").getByRole("button", { name: "Guide me" }).click();
  await expect(guide).toContainText("4 of 4");
});

const guide = (page: Page) => page.getByRole("dialog", { name: "Guide" });
const step = (page: Page, title: string) => guide(page).getByRole("group", { name: title });
const modulator = (page: Page) => page.locator(".signal").getByRole("button", { name: /^Modulator/ });

/** Guide me, answering the DAC question with `dac` and "No" to the others, to where to start. */
async function answer(page: Page, dac: RegExp) {
  await page.locator(".signal").getByRole("button", { name: "Guide me" }).click();
  await step(page, "Your DAC").getByRole("button", { name: dac }).click();
  for (const title of ["Your amplifier", "Your volume"]) {
    await guide(page).getByRole("button", { name: "Next" }).click();
    await step(page, title)
      .getByRole("button", { name: /^No\b(?! sure)/ })
      .click();
  }
  await guide(page).getByRole("button", { name: "Next" }).click();
  await expect(guide(page)).toContainText("Rate and modulator");
}

test("v2: the guide's pairs suit the DAC, apply as one change, and go up to DSD1024 with AHM and back", async ({ page }) => {
  await openV2(page, "v2pairs");
  await expect(modulator(page)).toContainText("DSD7");
  await answer(page, /^An older ESS chip/);
  // Rate and modulator as pairs: DSD512 suits an older ESS chip, fifth order.
  const pair = (label: RegExp) => guide(page).locator("li.pair", { hasText: label });
  await expect(pair(/^DSD512 · ASDM5EC-fast/)).toContainText("Suits your DAC");
  await expect(pair(/^DSD512 · ASDM5EC-fast/)).toContainText("For your answers");
  // The variants carry what Signalyst has said about each: CPU load and character.
  await expect(guide(page)).toContainText("CPU: lightest");
  await shot(page, "v2-guide-pairs");

  await pair(/^DSD512 · ASDM5EC-fast/)
    .getByRole("button", { name: "Use" })
    .click();
  await expect(pair(/^DSD512 · ASDM5EC-fast/)).toContainText("Now using");
  await expect(modulator(page)).toContainText("ASDM5EC-fast");
  // DSD1024 with AHM is one change: rate and modulator together, and back down again.
  await pair(/^DSD1024 · AHM5EC8B/)
    .getByRole("button", { name: "Use" })
    .click();
  await expect(modulator(page)).toContainText("AHM5EC8B");
  await expect(page.locator(".signal")).toContainText("DSD1024");
  await pair(/^DSD256 · ASDM5EC-fast/)
    .getByRole("button", { name: "Use" })
    .click();
  await expect(modulator(page)).toContainText("ASDM5EC-fast");
  await expect(page.locator(".signal")).toContainText("DSD256");
});

test("v2: a DAC that converts DSD: the guide offers PCM at once, still has the DSD pairs, and switches", async ({ page }) => {
  await openV2(page, "v2converts");
  await answer(page, /^It converts/);
  // No dead end: the pairs are folded away under "Staying in DSD?", and still there.
  await expect(guide(page).locator("li.pair").first()).toBeHidden();
  await guide(page).getByText("Staying in DSD?").click();
  await expect(guide(page).locator("li.pair").first()).toBeVisible();
  await expect(guide(page)).not.toContainText("Suits your DAC");
  // The first step, where "It converts" was the answer, offers PCM.
  for (let i = 0; i < 3; i++) await guide(page).getByRole("button", { name: "Back" }).click();
  await expect(guide(page)).toContainText("1 of 4");
  await expect(guide(page)).toContainText("PCM output usually sounds better");
  await guide(page).getByRole("button", { name: "Switch to PCM" }).click();
  await expect(page.locator(".signal").getByRole("button", { name: /^Dither/ })).toBeVisible();
});

test("v2: HQPlayer falling behind raises the alarm", async ({ page }) => {
  await openV2(page, "v2behindalarm");
  await expect(page.locator(".banner", { hasText: /falling behind/ })).toBeVisible();
});
