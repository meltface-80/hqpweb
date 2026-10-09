// The v2 layout preview (docs/design-v2-layout.md): the meter: its strip, its views, a stored view from before, no meter stream, and its delay.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { openV2, shot } from "./v2-helpers.ts";

test("v2: the strip shows levels; it opens to a square of spectrum views", async ({ page }) => {
  await openV2(page, "v2meter");
  const meter = page.getByRole("region", { name: "Meter" });
  const open = meter.getByRole("button", { name: "Open the meter" });
  await expect(meter.locator("canvas.mini")).toBeVisible(); // live: it draws instead of a note
  // Each side's peak, beside its bar (from the fake's volume); stacked so it fits a phone.
  await expect(open.locator(".peak")).toHaveText(/L −22\.0\s*R −22\.0/);
  await open.click();
  await expect(meter.locator("canvas.big")).toBeVisible();
  await expect(meter.getByRole("button", { name: "Levels" })).toHaveCount(0); // Levels lives in the strip
  // Owner's order: Waterfall, Line, Bars; Waterfall opens first.
  await expect(
    meter
      .getByRole("group", { name: "Meter view" })
      .getByRole("button", { name: /^(Waterfall|Line|Bars|Stereo|Width|Dynamics)$/ }),
  ).toHaveText(["Waterfall", "Line", "Bars", "Stereo", "Width", "Dynamics"]);
  await expect(meter.getByRole("button", { name: "Waterfall" })).toHaveAttribute("aria-pressed", "true");
  await meter.getByRole("button", { name: "Bars" }).click();
  // The axis labels sit where the log scale puts them: 200 Hz about a third across, not a caption.
  const plot = (await meter.locator("canvas.big").boundingBox())!;
  const at200 = (await meter.locator(".axis span", { hasText: /^200$/ }).boundingBox())!;
  const frac = (at200.x + at200.width / 2 - plot.x) / plot.width;
  expect(frac).toBeGreaterThan(0.25);
  expect(frac).toBeLessThan(0.4);
  await expect(meter.locator(".dbs")).toContainText("-40");
  // The dB scale sits beside the plot, never over the bars.
  const dbs = (await meter.locator(".dbs").boundingBox())!;
  expect(dbs.x).toBeGreaterThanOrEqual(plot.x + plot.width);
  // What the views show is behind (i), not under the chart.
  const about = meter.locator("#meter-about");
  await expect(about).toBeHidden();
  await meter.getByRole("button", { name: "About this meter" }).click();
  await expect(about).toContainText("after HQPlayer's volume");
  // Timing follows HQPlayer's output buffer (the fake reports 1.05 s), nudged by ear.
  const timing = meter.locator(".timing");
  await expect(timing).toContainText("waits 0.5 s");
  await expect(timing).toContainText("what you hear (HQPlayer reports 1.0 s of output buffer)");
  await timing.getByRole("button", { name: "Meter later" }).click();
  await expect(timing).toContainText("waits 0.6 s");
  await expect(timing).toContainText("+0.1 s");
  await timing.getByRole("button", { name: "Auto" }).click();
  await expect(timing).toContainText("waits 0.5 s");
  await meter.screenshot({ path: fileURLToPath(new URL("screenshots/v2-5-meter-bars.png", import.meta.url)) });
  // Stereo: left and right from the centre; the gutter labels frequency, the axis L and R.
  await meter.getByRole("button", { name: "Stereo" }).click();
  await expect(meter.locator(".axis")).toContainText("L");
  await expect(meter.locator(".dbs")).toContainText("2k");
  await meter.screenshot({ path: fileURLToPath(new URL("screenshots/v2-5-meter-stereo.png", import.meta.url)) });
  // Width: from mono (right) to out of phase (left), frequency up the side.
  await meter.getByRole("button", { name: "Width" }).click();
  await expect(meter.locator(".axis")).toContainText("mono");
  await page.waitForTimeout(800); // a few updates, eased
  await meter.screenshot({ path: fileURLToPath(new URL("screenshots/v2-5-meter-width.png", import.meta.url)) });
  // Dynamics: 30 s of loudness; the crest factor once there's enough of it.
  await meter.getByRole("button", { name: "Dynamics" }).click();
  await expect(meter.locator(".axis")).toContainText("30 s ago");
  await expect(meter.locator(".axis")).toContainText(/now · crest \d+\.\d dB/);
  await meter.screenshot({ path: fileURLToPath(new URL("screenshots/v2-5-meter-dynamics.png", import.meta.url)) });
  await meter.getByRole("button", { name: "Waterfall" }).click();
  await shot(page, "v2-5-meter");
  await meter.getByRole("button", { name: "Close the meter" }).click();
  await expect(meter.locator("canvas.big")).toHaveCount(0);
});

test("v2: a meter view stored as Levels (from before) opens as Bars", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("instance", "v2meter");
    localStorage.setItem("prefs-v1", JSON.stringify({ layout: "v2", meterOpen: true, meterView: "levels" }));
  });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Meter" }).getByRole("button", { name: "Bars" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("v2: without a meter, the strip says so", async ({ page }) => {
  await openV2(page, "v2nometer");
  await expect(page.getByRole("region", { name: "Meter" })).toContainText("No meter from this HQPlayer");
});

test("v2: the meter waits to line up with what's heard", async ({ page }) => {
  // Fake output buffer 1.05 s, less hqpweb's own 0.5 s, plus a 2.5 s nudge: 3 s before anything is drawn.
  await page.addInitScript(() => {
    localStorage.setItem("instance", "v2meter");
    localStorage.setItem("prefs-v1", JSON.stringify({ layout: "v2", meterNudge: { v2meter: 2500 } }));
  });
  await page.goto("/");
  const strip = page.getByRole("region", { name: "Meter" }).getByRole("button", { name: /the meter$/ });
  await expect(strip.locator("canvas.mini")).toBeVisible();
  await page.waitForTimeout(1500); // updates are arriving, but none is due yet
  await expect(strip.locator(".peak")).toHaveText("");
  await expect(strip.locator(".peak")).toContainText("L −", { timeout: 6000 });
});
