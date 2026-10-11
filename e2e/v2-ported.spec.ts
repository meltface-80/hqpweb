// Flows first tested in the classic layout (retired), in the layout: a filter the
// ratio rules out offers rates that fit; the dither guide; a queued track the modulator can't start.
import { expect, test, type Page } from "@playwright/test";
import { fakeUrl } from "./hosts.ts";
import { openV2, shot } from "./v2-helpers.ts";

const row = (page: Page, label: string) => page.locator(".signal").getByRole("button", { name: new RegExp(`^${label}`) });
const sheet = (page: Page) => page.locator("dialog[open]");
const step = (page: Page, title: string) => sheet(page).getByRole("group", { name: title });
const succeeded = (page: Page) => expect(page.locator("footer .msg")).toContainText("✓");
async function poke(id: string, body: object) {
  const r = await fetch(fakeUrl(id), { method: "POST", body: JSON.stringify(body) });
  expect(r.status).toBe(204);
}

test("v2: a filter the ratio rules out says so, and picking it offers rates that fit", async ({ page }) => {
  await openV2(page, "v2ratio");
  await row(page, "1x filter").click();
  const fft = sheet(page).locator("li.row", { has: page.getByRole("button", { name: /^FFT\b/ }) });
  await expect(fft).toContainText("won't play this ratio");
  await expect(fft).toContainText("power-of-two");
  await sheet(page)
    .getByRole("button", { name: /^FFT\b/ })
    .click();

  await expect(sheet(page).getByRole("heading")).toContainText("FFT");
  await shot(page, "v2-ratio-rate-sheet");
  await sheet(page).getByRole("button", { name: "176.4 kHz" }).click();
  await succeeded(page);
  await expect(row(page, "1x filter")).toContainText("FFT");
  await expect(page.locator(".headline .big")).toHaveText("176.4 kHz");
});

test("v2: dither: a ladder DAC at 384k is offered NS5 or NS9 as equals, and one applies", async ({ page }) => {
  await openV2(page, "v2dither");
  await expect(row(page, "Dither")).toContainText("TPDF");
  await row(page, "Dither").click();
  // One guide, the flow: from the list, "Not sure where to start?".
  await sheet(page)
    .getByRole("button", { name: /Guide me$/ })
    .click();
  await step(page, "Your DAC")
    .getByRole("button", { name: /^Ladder/ })
    .click();
  await sheet(page).getByRole("button", { name: "Next" }).click();
  await step(page, "The connection").getByRole("button", { name: /^USB/ }).click();
  await sheet(page).getByRole("button", { name: "Next" }).click();
  for (const n of ["NS5", "NS9"]) await expect(sheet(page).getByRole("button", { name: n })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "LNS15" })).toBeHidden();
  await shot(page, "v2-dither-guide");
  await sheet(page).getByRole("button", { name: "NS9" }).click();
  await expect(row(page, "Dither")).toContainText("NS9");
});

test("v2: a queued track the modulator can't start opens the list, where it says why", async ({ page }) => {
  await openV2(page, "v2wedgemod");
  await poke("v2wedgemod", { playlist: ["/music/Example Artist/Example Album/01 - Example.flac"], sourceRate: 44_100 });
  await page.getByRole("button", { name: /^Fix/ }).click();
  await sheet(page)
    .getByRole("button", { name: /another modulator/ })
    .click();
  await expect(sheet(page).getByRole("searchbox")).toBeVisible(); // the list (no tabs)
  const ahm = sheet(page).locator("li.row", { has: page.getByRole("button", { name: /^AHM7EC8B\b/ }) });
  await expect(ahm.first()).toContainText("won't play");
  await shot(page, "v2-wedge-modulator");
  await sheet(page)
    .getByRole("button", { name: /^ASDM7EC-fast\b/ })
    .first()
    .click();
  await expect(row(page, "Modulator")).toContainText("ASDM7EC-fast");
  await expect(page.locator("p", { hasText: /won't start/ })).toBeHidden();
});

test("v2: a pick from the guide's flow that can't keep up is rolled back, and the sheet says so", async ({ page }) => {
  await openV2(page, "v2behind");
  await row(page, "Modulator").click();
  await sheet(page)
    .getByRole("button", { name: /Guide me$/ })
    .click();
  await step(page, "Your DAC")
    .getByRole("button", { name: /^DSD goes straight/ })
    .click();
  for (let i = 0; i < 3 && (await sheet(page).getByRole("button", { name: "Next" }).isVisible()); i++) {
    const s = sheet(page).locator("fieldset, [role=group]").first();
    const no = s.getByRole("button", { name: /^No\b(?! sure)/ });
    if (await no.count()) await no.first().click();
    await sheet(page).getByRole("button", { name: "Next" }).click();
  }
  await sheet(page).locator("li.pair").getByRole("button", { name: "Use" }).first().click();
  await expect(sheet(page).locator(".msg.result")).toContainText(/rolled back/i, { timeout: 10_000 });
});
