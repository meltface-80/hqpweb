// Browser smoke tests: the flows a listener uses most, against fake HQPlayers.
// Each flow has its own instance (see stack.ts), so they can run in parallel.
// They check outcomes (what HQPlayer took, what the screen shows) and short key
// phrases, never whole sentences: rewording a message shouldn't break a test
// (docs/quality-plan.md, principle 7). Screenshots are for people; never compared.
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
/** The change succeeded: the result line carries a ✓. */
const succeeded = (page: Page) => expect(footer(page)).toContainText("✓");

test("pick a filter, see it confirmed, undo it", async ({ page }) => {
  await openOn(page, "pick");
  await expect(row(page, "1x filter")).toContainText("poly-sinc-gauss-xla");

  await row(page, "1x filter").click();
  await sheet(page).getByRole("searchbox").fill("gauss-long");
  await shot(page, "pick-1-search");
  await sheet(page)
    .getByRole("button", { name: /^poly-sinc-gauss-long/ })
    .click();

  await succeeded(page);
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

  await expect(footer(page)).toContainText(/rolled back/i, { timeout: 10_000 });
  await expect(row(page, "1x filter")).toContainText("poly-sinc-gauss-xla");
  await expect(page.locator(".headline .state")).toHaveText("Playing");
  await shot(page, "rollback-1-rolled-back");

  await row(page, "1x filter").click();
  await expect(sheet(page).getByRole("button", { name: /^poly-sinc-gauss-long/ })).toContainText(/failed here/);
  await shot(page, "rollback-2-flagged");
});

test("a rollback that leaves HQPlayer's own playlist stopped offers Restart playback", async ({ page }) => {
  await openOn(page, "restart");
  await page.locator("summary", { hasText: "Advanced" }).click();
  await row(page, "Output rate").click();
  page.once("dialog", (d) => void d.accept());
  await sheet(page)
    .getByRole("button", { name: /^192 kHz/ })
    .click();

  await expect(footer(page)).toContainText(/rolled back/i, { timeout: 10_000 });
  await expect(page.locator(".headline .state")).toHaveText("Stopped");
  await shot(page, "restart-1-offered");

  await page.getByRole("button", { name: "Restart playback" }).click();
  await expect(page.locator(".headline .state")).toHaveText("Playing");
  // Really playing: the position moves (measured: Play alone can show "playing" and not move).
  const position = page.locator(".seek span").first();
  const at = await position.textContent();
  await expect.poll(() => position.textContent(), { timeout: 10_000 }).not.toBe(at);
  await expect(page.getByRole("button", { name: "Restart playback" })).toBeHidden();
});

test("a filter that can't convert this ratio is hidden, and picking it offers rates that fit", async ({ page }) => {
  await openOn(page, "ratio");
  await row(page, "1x filter").click();

  await expect(sheet(page).getByRole("button", { name: "compatible" })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet(page).getByRole("button", { name: /^FFT/ })).toHaveCount(0);
  await shot(page, "ratio-1-compatible");

  await sheet(page).getByRole("button", { name: "Show all" }).click();
  await sheet(page).getByRole("button", { name: /^FFT/ }).click();

  await expect(sheet(page).getByRole("heading")).toContainText("FFT");
  await expect(sheet(page)).toContainText("power-of-two");
  await shot(page, "ratio-2-rate-sheet");
  await sheet(page).getByRole("button", { name: "176.4 kHz" }).click();

  await succeeded(page);
  await expect(row(page, "1x filter")).toContainText("FFT");
  await expect(page.locator(".headline .big")).toHaveText("176.4 kHz");
});

test("a queued track that can't start is explained, and Fix offers rates that fit", async ({ page }) => {
  await openOn(page, "wedge");
  // Queued after the page opened: a playlist from before hqpweb started isn't trusted.
  await poke("wedge", { playlist: ["/music/Example Artist/Example Album/01 - Example.flac"], sourceRate: 44_100 });

  const banner = page.locator("p", { hasText: /won't start/ });
  await expect(banner).toContainText("power-of-two");
  await shot(page, "wedge-1-banner");

  await page.getByRole("button", { name: /^Fix/ }).click();
  await expect(sheet(page).getByRole("button", { name: /another filter/ })).toBeVisible();
  await shot(page, "wedge-2-sheet");
  await sheet(page).getByRole("button", { name: "176.4 kHz" }).click();

  await succeeded(page);
  await expect(page.locator(".headline .big")).toHaveText("176.4 kHz");
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

  const banner = page.locator("p", { hasText: /jumped/ });
  await expect(banner).toContainText("-3");
  await shot(page, "jump-1-banner");

  await banner.getByRole("button", { name: /-44/ }).click();
  await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue("-44");
  await expect(banner).toBeHidden();
});

test("the volume buttons step by 1 dB", async ({ page }) => {
  await openOn(page, "volume");
  const slider = page.getByRole("slider", { name: "Volume" });
  await expect(slider).toHaveValue("-30");

  await page.getByRole("button", { name: "Down 1 dB" }).click();
  await expect(slider).toHaveValue("-31");

  await page.getByRole("button", { name: "Up 1 dB" }).click();
  await expect(slider).toHaveValue("-30");
});

test("a recording that keeps needing apodization suggests apodizing filters", async ({ page }) => {
  await openOn(page, "apod");
  const notice = page.locator("p", { hasText: /apodization/ });
  await expect(notice).toContainText("25");
  await shot(page, "apod-1-notice");

  await notice.getByRole("button").click();
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
  await succeeded(page);
  await expect(row(page, "Output rate")).toContainText("192 kHz");

  const invert = page.getByRole("switch", { name: "Invert polarity" });
  await expect(invert).not.toBeChecked();
  await invert.click();
  await expect(invert).toBeChecked();
  await shot(page, "advanced-1-applied");
});

test("Settings: add an instance by address, rename it, and remove it", async ({ page }) => {
  await openOn(page, "about");
  await page.getByRole("button", { name: "Settings" }).click();
  const item = () => sheet(page).locator("ul.instances li").filter({ hasText: "127.0.0.1:1" });

  // Port 1 never answers: it's added anyway, with a warning saying why.
  await sheet(page).getByLabel("Name").fill("Spare test box");
  await sheet(page).getByLabel("Host").fill("127.0.0.1");
  await sheet(page).getByLabel("Port").fill("1");
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(item()).toContainText("Spare test box");
  await expect(sheet(page)).toContainText("doesn't answer");

  page.once("dialog", (d) => void d.accept("Renamed box"));
  await item().getByRole("button", { name: "Rename" }).click();
  await expect(item()).toContainText("Renamed box");
  await shot(page, "settings-1-instance-added");

  page.once("dialog", (d) => void d.accept());
  await item().getByRole("button", { name: "Remove" }).click();
  await expect(item()).toHaveCount(0);
});

test("Settings shows the version and the non-affiliation notice", async ({ page }) => {
  await openOn(page, "about");
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(sheet(page)).toContainText(`hqpweb ${pkg.version}`);
  // The README and About must keep the non-affiliation notice (CLAUDE.md).
  await expect(sheet(page)).toContainText("Not affiliated");
  await sheet(page).getByRole("heading", { name: "About", exact: true }).scrollIntoViewIfNeeded();
  await shot(page, "about-1-settings");
});
