// The layout (docs/design-v2-layout.md): widths (a laptop's two columns, a 320 px column), and a
// device that had chosen the retired Classic layout.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { expect, test } from "@playwright/test";
import { shot } from "./v2-helpers.ts";

test("v2: on a laptop the two columns use the width, and names stay on one line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("instance", "v2wide");
  });
  await page.goto("/");
  const card = page.locator(".signal");
  await expect(card).toBeVisible();
  expect((await card.boundingBox())!.width).toBeGreaterThan(560); // was ~260 when the width rule lost
  const row = card.getByRole("button", { name: /^1x filter/ });
  expect((await row.boundingBox())!.height).toBeLessThan(60); // label and name on one line
  // The strip's Meter toggle stays inside the strip.
  const strip = page.getByRole("region", { name: "Meter" }).getByRole("button", { name: /the meter$/ });
  const label = strip.locator(".label");
  const [s, l] = [(await strip.boundingBox())!, (await label.boundingBox())!];
  expect(l.x + l.width).toBeLessThanOrEqual(s.x + s.width);
  await shot(page, "v2-10-laptop");
});

test("v2: in a 320 px column the meter strip keeps its bars and its toggle inside", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem("instance", "v2wide");
  });
  await page.goto("/");
  const strip = page.getByRole("region", { name: "Meter" }).getByRole("button", { name: /the meter$/ });
  await expect(strip.locator("canvas.mini")).toBeVisible();
  const [s, l, c] = [
    (await strip.boundingBox())!,
    (await strip.locator(".label").boundingBox())!,
    (await strip.locator("canvas.mini").boundingBox())!,
  ];
  expect(l.x + l.width).toBeLessThanOrEqual(s.x + s.width);
  expect(c.width).toBeGreaterThanOrEqual(60); // the level bars aren't squeezed away
});

test("a device that chose the retired Classic layout gets the layout, keeps its other settings, and drops the old ones", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("instance", "v2fromclassic");
    // As saved before: the layout choice and its two settings, beside ones that still exist.
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      const old = { layout: "classic", filterOrder: "rating", adviceTab: "guide", theme: "dark", volumeStep: 2 };
      localStorage.setItem("prefs-v1", JSON.stringify(old));
    }
  });
  await page.goto("/");
  await expect(page.locator(".signal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Down 2 dB" })).toBeVisible(); // its volume step kept
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.locator("dialog[open]")).not.toContainText("Classic layout");
  // The next save writes today's settings only.
  await page.getByRole("switch", { name: /Open “Advanced” by default/ }).check();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("prefs-v1") ?? "{}") as Record<string, unknown>);
  expect(Object.keys(saved)).not.toContain("layout");
  expect(Object.keys(saved)).not.toContain("filterOrder");
  expect(Object.keys(saved)).not.toContain("adviceTab");
  expect(saved).toMatchObject({ theme: "dark", volumeStep: 2, advancedOpen: true });
});
