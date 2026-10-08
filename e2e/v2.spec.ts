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

test("v2: the mini bar takes over when the now card scrolls away", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openV2(page, "v2mini");
  const mini = page.getByRole("region", { name: "Now playing, compact" });
  await expect(mini).toHaveCount(0);
  await page.getByRole("button", { name: "History" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 2000);
  await expect(mini).toBeVisible();
  await expect(mini).toContainText("keeping up");
  await mini.getByRole("button", { name: /^Down/ }).click();
  await expect(mini).toContainText("-23");
  // It sits above the footer (the change's result), not over it.
  const footer = page.locator("footer");
  await expect(footer).toContainText("Volume");
  // Both slide (0.4 s): once the footer is fully on screen, the bar must be above it.
  await expect
    .poll(async () => {
      const [m, f, vh] = [await mini.boundingBox(), await footer.boundingBox(), await page.evaluate(() => innerHeight)];
      return f!.y + f!.height <= vh + 1 && m!.y + m!.height <= f!.y + 1;
    })
    .toBe(true);
  await shot(page, "v2-4-mini-bar");
  await mini.getByRole("button", { name: "Back to now playing" }).click();
  await expect(mini).toHaveCount(0);
});

test("v2: the strip shows levels; it opens to a square of spectrum views", async ({ page }) => {
  await openV2(page, "v2meter");
  const meter = page.getByRole("region", { name: "Meter" });
  const open = meter.getByRole("button", { name: "Open the meter" });
  await expect(meter.locator("canvas.mini")).toBeVisible(); // live: it draws instead of a note
  await expect(open).toContainText("-22.0 dB"); // the peak, from the fake's volume
  await open.click();
  await expect(meter.locator("canvas.big")).toBeVisible();
  await expect(meter.getByRole("button", { name: "Levels" })).toHaveCount(0); // Levels lives in the strip
  await meter
    .locator("canvas.big")
    .screenshot({ path: fileURLToPath(new URL("screenshots/v2-5-meter-bars.png", import.meta.url)) });
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
  await openV2(page, "v2");
  await expect(page.getByRole("region", { name: "Meter" })).toContainText("No meter from this HQPlayer");
});

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

test("v2: Compare plays A and B in turn, reads which is heard, and says what it can't offer", async ({ page }) => {
  await openV2(page, "v2compare");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Compare" });
  await expect(sheet).toContainText("Hearing A");
  await sheet.getByRole("combobox", { name: "B modulator" }).selectOption("ASDM7EC-fast");
  await expect(sheet).toContainText("quickest");
  await sheet.getByRole("button", { name: "B", exact: true }).click();
  await expect(sheet).toContainText("Hearing B", { timeout: 15_000 });
  await expect(sheet.getByRole("button", { name: "B", exact: true })).toHaveAttribute("aria-pressed", "true");
  await shot(page, "v2-8-compare");
  await sheet.getByRole("button", { name: "A", exact: true }).click();
  await expect(sheet).toContainText("Hearing A", { timeout: 15_000 });
  // PCM was never seen on this fake: B keeps the names and says why it can't offer choices.
  await sheet.getByRole("combobox", { name: "B mode" }).selectOption({ label: "PCM" });
  await expect(sheet).toContainText("hasn't seen PCM's lists");
  await expect(sheet).toContainText("pauses about 5 s");
  await sheet.getByRole("button", { name: "Keep A" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".signal").getByRole("button", { name: /^Modulator/ })).toContainText("AHM7EC8B");
});

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
