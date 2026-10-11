// Roon, switched on as a listener does it (Settings → Roon), against each lane's fake Roon Core
// (stack.ts): the server's link on the web, the page's own in the app. Then a reload, as the app
// relaunching: with Roon on, the app's page once looped at start and stayed blank (#120).
// Same rules as smoke.spec.ts: outcomes and short phrases only.
import { expect, test } from "@playwright/test";
import { approveRoon, can, fakeRoonPort, shotPath } from "./hosts.ts";
import { openV2 } from "./v2-helpers.ts";

// The web lanes share one server, and so its Roon link: switch it off again for the tests after.
test.afterEach(async ({ page }) => {
  if (!can().roon) return;
  await page
    .evaluate(() =>
      fetch("/api/roon", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
    )
    .catch(() => undefined);
});

test("Roon: switched on and paired, the zone's track shows on the card, and again after a reload", async ({ page }) => {
  test.skip(!can().roon, "this host has no Roon");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openV2(page, "roon");

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.locator("dialog[open]");
  await settings.getByRole("tab", { name: "Roon" }).click();
  await settings.getByRole("switch", { name: /Roon's now playing/ }).check();
  await settings.getByLabel("Roon Core host").fill("127.0.0.1");
  await settings.getByLabel("Roon Core port").fill(String(await fakeRoonPort()));
  await settings.getByRole("button", { name: "Connect" }).click();
  await expect(settings).toContainText("Waiting for approval");
  await approveRoon();
  await expect(settings).toContainText("Connected");
  await settings.getByLabel("Roon flow").selectOption({ label: "Listening Room" });
  await settings.getByRole("button", { name: "Close" }).click();

  const card = page.locator("section.now");
  await expect(card).toContainText("Example Track");
  await expect(card).toContainText("Example Artist");
  // The art loads from where the host says (the server's route, or the core itself in the app).
  await expect.poll(() => card.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: shotPath("roon-1-now-playing"), fullPage: true });

  await page.reload();
  await expect(page.locator(".signal")).toBeVisible();
  await expect(card).toContainText("Example Track");
  expect(errors).toEqual([]);
});
