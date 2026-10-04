// Browser smoke tests: the flows a listener uses most, against fake HQPlayers.
// Each flow has its own instance (see stack.ts), so they can run in parallel.
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import pkg from "../package.json" with { type: "json" };
import { CONTROL_PORT } from "./stack.ts";

/** Open the app on one flow's instance. */
async function openOn(page: Page, id: string) {
  await page.addInitScript((i) => localStorage.setItem("instance", i), id);
  await page.goto("/");
  await expect(page.locator("section.now")).toBeVisible();
}

/** Change a fake's state, as HQPlayer or its owner would. */
async function poke(id: string, body: object) {
  const r = await fetch(`http://127.0.0.1:${CONTROL_PORT}/fake/${id}`, { method: "POST", body: JSON.stringify(body) });
  expect(r.status).toBe(204);
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: fileURLToPath(new URL(`screenshots/${name}.png`, import.meta.url)), fullPage: true });
const row = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}`) });
const sheet = (page: Page) => page.locator("dialog[open]");
const footer = (page: Page) => page.locator("footer .msg");

test("pick a filter, see it confirmed, undo it", async ({ page }) => {
  await openOn(page, "pick");
  await expect(row(page, "1x filter")).toContainText("poly-sinc-gauss-xla");

  await row(page, "1x filter").click();
  await sheet(page).getByRole("searchbox").fill("gauss-long");
  await shot(page, "pick-1-search");
  await sheet(page)
    .getByRole("button", { name: /^poly-sinc-gauss-long/ })
    .click();

  await expect(footer(page)).toContainText("✓ 1x filter → poly-sinc-gauss-long");
  await expect(footer(page)).toContainText("playback OK");
  await expect(row(page, "1x filter")).toContainText("poly-sinc-gauss-long");
  await shot(page, "pick-2-applied");

  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(row(page, "1x filter")).toContainText("poly-sinc-gauss-xla");
});

test("a filter this machine can't keep up with is rolled back, and flagged next time", async ({ page }) => {
  await openOn(page, "rollback");
  await row(page, "1x filter").click();
  await sheet(page)
    .getByRole("button", { name: /^poly-sinc-gauss-long/ })
    .click();

  await expect(footer(page)).toContainText("Rolled back:", { timeout: 10_000 });
  await expect(footer(page)).toContainText("1x filter back to poly-sinc-gauss-xla");
  await expect(footer(page)).toContainText("Playback resumed.");
  await expect(row(page, "1x filter")).toContainText("poly-sinc-gauss-xla");
  await shot(page, "rollback-1-rolled-back");

  await row(page, "1x filter").click();
  await expect(sheet(page).getByRole("button", { name: /^poly-sinc-gauss-long/ })).toContainText("failed here before");
  await shot(page, "rollback-2-flagged");
});

test("a filter that can't convert this ratio is hidden, and picking it offers rates that fit", async ({ page }) => {
  await openOn(page, "ratio");
  await row(page, "1x filter").click();

  await expect(sheet(page).getByRole("button", { name: "compatible" })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet(page)).toContainText("hidden: they can't convert 44.1 kHz → 192 kHz");
  await expect(sheet(page).getByRole("button", { name: /^FFT/ })).toHaveCount(0);
  await shot(page, "ratio-1-compatible");

  await sheet(page).getByRole("button", { name: "Show all" }).click();
  await sheet(page).getByRole("button", { name: /^FFT/ }).click();

  await expect(sheet(page).getByRole("heading")).toHaveText("FFT can't play at this rate");
  await expect(sheet(page)).toContainText("FFT needs a power-of-two ratio; 44.1k → 192k is 4.35×");
  await shot(page, "ratio-2-rate-sheet");
  await sheet(page).getByRole("button", { name: "176.4 kHz" }).click();

  await expect(footer(page)).toContainText("✓");
  await expect(row(page, "1x filter")).toContainText("FFT");
  await expect(page.locator(".headline .big")).toHaveText("176.4 kHz");
});

test("a queued track that can't start is explained, and Fix offers rates that fit", async ({ page }) => {
  await openOn(page, "wedge");
  // Queued after the page opened: a playlist from before hqpweb started isn't trusted.
  await poke("wedge", { playlist: ["/music/Example Artist/Example Album/01 - Example.flac"], sourceRate: 44_100 });

  const banner = page.getByText("The next track won't start");
  await expect(banner).toContainText("FFT needs a power-of-two ratio; 44.1k → 192k is 4.35×");
  await shot(page, "wedge-1-banner");

  await page.getByRole("button", { name: "Fix…" }).click();
  await expect(sheet(page).getByRole("button", { name: "Choose another filter" })).toBeVisible();
  await expect(sheet(page)).toContainText("Then press Play.");
  await shot(page, "wedge-2-sheet");
  await sheet(page).getByRole("button", { name: "176.4 kHz" }).click();

  await expect(footer(page)).toContainText("✓ Output rate → 176.4 kHz");
  await expect(banner).toBeHidden();

  // The sheet leaves Play to the listener: no surprise playback.
  await expect(page.locator(".headline .state")).toHaveText("Stopped");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.locator(".headline .state")).toHaveText("Playing");
});

test("a volume jump hqpweb didn't make is flagged, and can be put back", async ({ page }) => {
  await openOn(page, "jump");
  await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue("-44");
  // As when HQPlayer restarts on its saved, louder setting.
  await poke("jump", { volume: -3 });

  await expect(page.getByText("Volume jumped from -44 to -3 dB")).toBeVisible();
  await shot(page, "jump-1-banner");

  await page.getByRole("button", { name: "Back to -44 dB" }).click();
  await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue("-44");
  await expect(page.getByText("Volume jumped")).toBeHidden();
});

test("the volume buttons step by 1 dB", async ({ page }) => {
  await openOn(page, "volume");
  const slider = page.getByRole("slider", { name: "Volume" });
  await expect(slider).toHaveValue("-30");

  await page.getByRole("button", { name: "Down 1 dB" }).click();
  await expect(footer(page)).toContainText("✓ Volume → -31 dB");
  await expect(slider).toHaveValue("-31");

  await page.getByRole("button", { name: "Up 1 dB" }).click();
  await expect(slider).toHaveValue("-30");
});

test("a recording that keeps needing apodization suggests apodizing filters", async ({ page }) => {
  await openOn(page, "apod");
  await expect(page.getByText("This recording keeps needing apodization (25 so far)")).toBeVisible();
  await expect(page.getByText("poly-sinc-hb isn't an apodizing filter")).toBeVisible();
  await shot(page, "apod-1-notice");

  await page.getByRole("button", { name: "Choose an apodizing filter…" }).click();
  await expect(sheet(page).getByRole("heading")).toHaveText("1x filter");
  await expect(sheet(page).getByRole("button", { name: "apodizing" })).toHaveAttribute("aria-pressed", "true");
  // IIR is apodizing; poly-sinc-hb isn't.
  await expect(sheet(page).getByRole("button", { name: /^IIR\b/ })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: /^poly-sinc-hb\b/ })).toHaveCount(0);
  await shot(page, "apod-2-picker");
});

test("Advanced: change the output rate after confirming, and switch an option", async ({ page }) => {
  await openOn(page, "advanced");
  await page.locator("summary", { hasText: "Advanced" }).click();

  await row(page, "Output rate").click();
  page.once("dialog", (d) => void d.accept());
  await sheet(page)
    .getByRole("button", { name: /^192 kHz/ })
    .click();
  await expect(footer(page)).toContainText("✓ Output rate → 192 kHz");
  await expect(row(page, "Output rate")).toContainText("192 kHz");

  const invert = page.getByRole("switch", { name: "Invert polarity" });
  await expect(invert).not.toBeChecked();
  await invert.click();
  await expect(footer(page)).toContainText("✓ Invert → true");
  await expect(invert).toBeChecked();
  await shot(page, "advanced-1-applied");
});

test("Settings shows the version and the non-affiliation notice", async ({ page }) => {
  await openOn(page, "about");
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(sheet(page)).toContainText(`hqpweb ${pkg.version}`);
  await expect(sheet(page)).toContainText("Not affiliated with, endorsed by, or supported by Signalyst or Roon Labs.");
  await sheet(page).getByRole("heading", { name: "About", exact: true }).scrollIntoViewIfNeeded();
  await shot(page, "about-1-settings");
});
