// The matrix profile row on the signal card (MatrixRow.svelte): always there, as part of the
// signal chain. What's been learned is kept in two sets, with HQPlayer's DAC correction running
// and without (Status `correction`): a filter that fell behind with it is flagged only while it
// runs, whichever profile runs it. Same rules as smoke.spec.ts: outcomes and short phrases only.
import { expect, test, type Page } from "@playwright/test";
import { shotPath } from "./hosts.ts";
import { openV2 } from "./v2-helpers.ts";

const footer = (page: Page) => page.locator("footer .msg");
const sheet = (page: Page) => page.getByRole("dialog", { name: "1x filter: choose" });
const open1x = async (page: Page) => {
  await page
    .locator(".signal")
    .getByRole("button", { name: /^1x filter/ })
    .click();
  await sheet(page).getByRole("searchbox").fill("sinc-Lh");
};
const sincLh = (page: Page) => sheet(page).locator("li.row", { has: page.getByRole("button", { name: /^sinc-Lh\b/ }) });
const profileRow = (page: Page) => page.locator(".signal").getByRole("button", { name: /^Matrix profile/ });
const picker = (page: Page) => page.locator("dialog[open]");
async function useProfile(page: Page, label: string) {
  await profileRow(page).click();
  await picker(page)
    .getByRole("button", { name: new RegExp(`^${label}`) })
    .click();
  await expect(footer(page)).toContainText("✓");
}

test("matrix: on the signal card; what fell behind with correction running is flagged only while it runs", async ({ page }) => {
  await openV2(page, "matrix");
  await expect(profileRow(page)).toContainText("Correction On");
  await page.locator(".signal").screenshot({ path: shotPath("matrix-1-signal-card") });

  // The sheet says where profiles are set up (this fake is Desktop), in full the first time.
  await profileRow(page).click();
  await expect(picker(page)).toContainText("HQPlayer Desktop, under its Matrix / Pipeline menu");
  await expect(picker(page)).toContainText("two sets");
  await picker(page).screenshot({ path: shotPath("matrix-2-picker-help") });
  await picker(page).getByRole("button", { name: "Show less" }).click();
  await expect(picker(page)).toContainText("Set up in Desktop's Matrix / Pipeline menu.");
  await expect(picker(page)).not.toContainText("two sets");
  await picker(page).screenshot({ path: shotPath("matrix-3-picker-short") });
  await page.keyboard.press("Escape");

  // sinc-Lh can't keep up here, with correction running ("Correction On"): rolled back, and learned so.
  await open1x(page);
  await sincLh(page)
    .getByRole("button", { name: /^sinc-Lh\b/ })
    .click();
  await expect(footer(page)).toContainText(/rolled back/i, { timeout: 10_000 });
  await open1x(page);
  await expect(sincLh(page)).toContainText(/failed here/i);
  await sheet(page).getByRole("button", { name: "Done" }).click();

  // A profile without correction: it isn't flagged there.
  await useProfile(page, "No Pipeline");
  await expect(profileRow(page)).toContainText("No Pipeline");
  await open1x(page);
  await expect(sincLh(page)).not.toContainText(/failed here/i);
  await sheet(page).getByRole("button", { name: "Done" }).click();

  // Default (no profile: HQPlayer's base settings, which correct here, as on the owner's Mac): the
  // same state as "Correction On", so it's flagged again.
  await useProfile(page, "Default");
  await expect(profileRow(page)).toContainText("Default");
  await open1x(page);
  await expect(sincLh(page)).toContainText(/failed here/i);
  await sheet(page).getByRole("button", { name: "Done" }).click();

  // The help stays short on this device.
  await page.reload();
  await profileRow(page).click();
  await expect(picker(page)).toContainText("Set up in Desktop's Matrix / Pipeline menu.");
  await picker(page).getByRole("button", { name: "More" }).click();
  await expect(picker(page)).toContainText("two sets");
});

test("matrix: with no profiles set up, the row says so and its sheet says where", async ({ page }) => {
  await openV2(page, "matrixnone");
  await expect(profileRow(page)).toContainText("No profiles created");
  await profileRow(page).click();
  await expect(picker(page)).toContainText("HQPlayer Desktop, under its Matrix / Pipeline menu");
  await expect(picker(page).getByRole("searchbox")).toHaveCount(0);
  await picker(page).screenshot({ path: shotPath("matrix-4-none") });
});

test("matrix: a name too long beside the label moves below it, whole; one that fits stays beside it", async ({ page }) => {
  await openV2(page, "matrixlong");
  const row = profileRow(page);
  const name = row.locator(".value:not(.measure)");
  await expect(name).toHaveText("Example DAC correction with a long name");
  // On a phone: below the label, and not cut off.
  const below = async () => {
    const [label, value] = [await row.locator(".label").boundingBox(), await name.boundingBox()];
    return value!.y >= label!.y + label!.height - 1;
  };
  await expect.poll(below).toBe(true);
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); // no sideways scroll
  await page.locator(".signal").screenshot({ path: shotPath("matrix-5-long-name") });

  // A short one stays on the label's line, at the right.
  await row.click();
  await picker(page)
    .getByRole("button", { name: /^Short/ })
    .click();
  await expect(footer(page)).toContainText("✓");
  await expect(name).toHaveText("Short");
  const beside = async () => {
    const [l, v] = [await row.locator(".label").boundingBox(), await name.boundingBox()];
    return Math.abs(v!.y + v!.height / 2 - (l!.y + l!.height / 2)) < 4;
  };
  await expect.poll(beside).toBe(true);
});
