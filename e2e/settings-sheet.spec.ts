// The Settings sheet keeps its top edge where it is when tabs of different heights are chosen
// (pinned below the page top on wide screens; a fixed-height bottom sheet on phones).
import { expect, test, type Page } from "@playwright/test";

async function sheetTops(page: Page) {
  await page.addInitScript(() => localStorage.setItem("instance", "settingssheet"));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const top = async () => (await page.locator("dialog[open] .sheet").boundingBox())!.y;
  const tops: number[] = [];
  for (const tab of ["HQPlayer", "Listening", "Appearance", "Roon", "HQPlayer"]) {
    await page.getByRole("tab", { name: tab }).click();
    tops.push(Math.round(await top()));
  }
  return tops;
}

for (const [label, size] of [
  ["phone", { width: 390, height: 844 }],
  ["laptop", { width: 1280, height: 800 }],
] as const)
  test(`Settings: the sheet's top stays put across tabs (${label})`, async ({ page }) => {
    await page.setViewportSize(size);
    const tops = await sheetTops(page);
    expect(new Set(tops).size, `tops: ${tops.join(", ")}`).toBe(1);
  });

test("Settings: About follows every tab, reachable by scrolling, including the long HQPlayer tab", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.addInitScript(() => localStorage.setItem("instance", "settingssheet"));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  for (const tab of ["HQPlayer", "Listening", "Appearance", "Roon"]) {
    await page.getByRole("tab", { name: tab }).click();
    const about = page.locator("dialog[open]").getByText("Not affiliated with");
    await about.scrollIntoViewIfNeeded();
    await expect(about, tab).toBeInViewport();
    // Neither the tab nor About scrolls on its own (About squeezed into a sliver of its own
    // scroll box was the bug): the sheet has one scrolling area for both.
    for (const sel of [".body:not([hidden]):not(.about)", ".about"]) {
      const clipped = await page.locator(`dialog[open] ${sel}`).evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(clipped, `${tab} ${sel}`).toBeLessThanOrEqual(1);
    }
  }
});
