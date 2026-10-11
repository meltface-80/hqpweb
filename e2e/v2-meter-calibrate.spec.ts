// Lining the meter up by ear (MeterCalibrate.svelte): its own screen from Settings → Listening
// (the meter links there); the phone clicks and you tap (reaction time), then the claps through HQPlayer.
// Real audio and people's timing can't be checked here: these check the steps and wiring.
import { expect, test, type Page } from "@playwright/test";
import { can } from "./hosts.ts";
import { openV2, shot } from "./v2-helpers.ts";

test.beforeEach(() => test.skip(!can().calibrate, "this host can't play the clap track"));

async function openCalibration(page: Page, id: string) {
  await openV2(page, id);
  const meter = page.getByRole("region", { name: "Meter" });
  await meter.getByRole("button", { name: "Open the meter" }).click();
  await meter.getByRole("button", { name: "About this meter" }).click();
  await meter.getByRole("button", { name: "Settings ›" }).click(); // the meter links to its timing in Settings
  await page.getByRole("button", { name: "Line up by ear…" }).click();
  const sheet = page.getByRole("dialog", { name: "Line up the meter" });
  await expect(sheet).toContainText("Two short steps");
  return sheet;
}

test("v2: tapping after each of the phone's clicks moves on to the claps through HQPlayer", async ({ page }) => {
  const sheet = await openCalibration(page, "v2cal");
  await shot(page, "v2-cal-1-intro");
  // The clicks come 1.0, 2.7, 4.0, 6.1, 7.6 and 9.5 s after Start, plus the audio output's
  // latency; a tap counts 0.1-0.9 s after one. Tap 0.5 s after each, timed in the page from
  // the Start press itself, as a person would: waits from the test runner add up, and a slow
  // runner (WebKit in CI) drifted out of the window.
  await sheet.evaluate(
    (dialog, offsets) => {
      [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start")!.click();
      for (const at of offsets)
        setTimeout(
          () => dialog.querySelector("button.pad")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
          at,
        );
    },
    [1500, 3200, 4500, 6600, 8100, 10_000],
  );
  await expect(sheet).toContainText("Step 1 of 2");
  await expect(sheet).toContainText("6 tapped", { timeout: 15_000 });
  await expect(sheet).toContainText("Step 2 of 2", { timeout: 5000 });
  await shot(page, "v2-cal-2-claps");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
});

test("v2: with no taps, it says it didn't catch the clicks and offers another go", async ({ page }) => {
  const sheet = await openCalibration(page, "v2calquiet");
  await sheet.getByRole("button", { name: "Start" }).click();
  await expect(sheet).toContainText("didn't catch enough clicks", { timeout: 16_000 });
  await expect(sheet.getByRole("button", { name: "Try again" })).toBeVisible();
});
