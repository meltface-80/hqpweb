// The v2 layout preview (docs/design-v2-layout.md): widths: a laptop's two columns and a 320 px column.
// Same rules as smoke.spec.ts: one instance per test, outcomes and short phrases only.
import { expect, test } from "@playwright/test";
import { shot } from "./v2-helpers.ts";

test("v2: on a laptop the two columns use the width, and names stay on one line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("instance", "v2wide");
    localStorage.setItem("prefs-v1", JSON.stringify({ layout: "v2" }));
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
    localStorage.setItem("prefs-v1", JSON.stringify({ layout: "v2" }));
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
