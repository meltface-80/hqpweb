// Browser tests for the modulator / dither sheet: the grouped list and the guides.
// Same rules as smoke.spec.ts: one instance per test (they run in parallel), outcomes
// and short key phrases only. What the guide suggests is advice/*.test.ts's job; here
// we check the screen asks, saves, and applies what the engine said.
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { CONTROL_PORT } from "./stack.ts";

async function openOn(page: Page, id: string) {
  await page.addInitScript((i) => localStorage.setItem("instance", i), id);
  await page.goto("/");
  await expect(page.locator("section.now")).toBeVisible();
}
const shot = (page: Page, name: string) =>
  page.screenshot({ path: fileURLToPath(new URL(`screenshots/${name}.png`, import.meta.url)), fullPage: true });
const row = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}`) });
const sheet = (page: Page) => page.locator("dialog[open]");
/** Change a fake's state, as HQPlayer or its owner would. */
async function poke(id: string, body: object) {
  const r = await fetch(`http://127.0.0.1:${CONTROL_PORT}/fake/${id}`, { method: "POST", body: JSON.stringify(body) });
  expect(r.status).toBe(204);
}
const step = (page: Page, title: string) => sheet(page).getByRole("group", { name: title });

test("modulators: grouped list, then the guide's answers, starting point and Compare", async ({ page }) => {
  await openOn(page, "guide");
  await expect(row(page, "Modulator")).toContainText("DSD7");

  // The list: newest family open, older ones folded, but the one in use still shown.
  await row(page, "Modulator").click();
  await expect(sheet(page).getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet(page)).toContainText(/newest ec line/i);
  await expect(sheet(page).getByRole("button", { name: /^DSD7 Gen/ })).toHaveAttribute("aria-current", "true");
  await expect(sheet(page).getByRole("button", { name: /^ASDM7ECv3/ })).toBeHidden();
  await expect(sheet(page)).toContainText("more CPU for less"); // the older EC series. note
  await shot(page, "advice-1-list");

  // The guide: three answers, saved as they're given.
  await sheet(page).getByRole("tab", { name: "Guide" }).click();
  await step(page, "Your DAC")
    .getByRole("button", { name: /^An older ESS chip/ })
    .click();
  await step(page, "Your amplifier")
    .getByRole("button", { name: /^No\b(?! sure)/ })
    .click();
  await step(page, "Your volume")
    .getByRole("button", { name: /^No\b(?! sure)/ })
    .click();
  await expect(sheet(page).getByRole("status")).toContainText("Saved");
  await expect(sheet(page)).toContainText("DSD512 suits");
  await expect(sheet(page)).toContainText("For your answers");
  await shot(page, "advice-2-guide");

  // Compare: A is the starting point, B what was playing.
  await sheet(page)
    .getByRole("button", { name: /^Compare/ })
    .click();
  await expect(row(page, "Modulator")).toContainText("ASDM5EC-fast");
  const ab = sheet(page).getByRole("group", { name: "Compare" });
  await ab.getByRole("button", { name: /^B/ }).click();
  await expect(row(page, "Modulator")).toContainText("DSD7");
  await ab.getByRole("button", { name: /^A/ }).click();
  await expect(row(page, "Modulator")).toContainText("ASDM5EC-fast");
  await expect(sheet(page)).toContainText("Now using");

  // Answers outlive the page; the guide tab is remembered; Change reopens in place.
  await page.reload();
  await row(page, "Modulator").click();
  await expect(sheet(page).getByRole("tab", { name: "Guide" })).toHaveAttribute("aria-selected", "true");
  await expect(step(page, "Your DAC")).toBeHidden();
  await sheet(page).getByRole("button", { name: "Change" }).first().click();
  await expect(step(page, "Your DAC").getByRole("button", { name: /^An older ESS chip/ })).toHaveClass(/sel/);
  await sheet(page).getByRole("button", { name: "Cancel" }).click();
  await expect(step(page, "Your DAC")).toBeHidden();
});

test("dither: a ladder DAC at 384k is offered NS5 or NS9 as equals, and one applies", async ({ page }) => {
  await openOn(page, "dither");
  await expect(row(page, "Dither")).toContainText("TPDF");

  await row(page, "Dither").click();
  await sheet(page).getByRole("tab", { name: "Guide" }).click();
  await step(page, "Your DAC")
    .getByRole("button", { name: /^Ladder/ })
    .click();
  await step(page, "The connection").getByRole("button", { name: /^USB/ }).click();
  for (const n of ["NS5", "NS9"]) await expect(sheet(page).getByRole("button", { name: n })).toBeVisible();
  // LNS15 is built for 705.6k and up: not offered here (it stays in the List).
  await expect(sheet(page).getByRole("button", { name: "LNS15" })).toBeHidden();
  await expect(sheet(page)).toContainText("DAC Bits");
  await expect(sheet(page)).toContainText("distorts"); // never "none", with the reason
  await shot(page, "advice-3-dither");

  await sheet(page).getByRole("button", { name: "NS9" }).click();
  await expect(row(page, "Dither")).toContainText("NS9");

  // The list keeps "none", in its own section.
  await sheet(page).getByRole("tab", { name: "List" }).click();
  await expect(sheet(page)).toContainText(/not for listening/i);
  await expect(sheet(page).getByRole("button", { name: /^none/ })).toBeVisible();
  // A recommended row shows the guide's reason, not the manual's narrower rate note.
  await expect(sheet(page).getByRole("button", { name: /^NS9/ })).toContainText("For your answers");
  await expect(sheet(page).getByRole("button", { name: /^NS9/ })).not.toContainText("176.4");
});

test("a queued track the modulator can't start opens the list, where it says why", async ({ page }) => {
  await openOn(page, "wedgemod");
  await poke("wedgemod", { playlist: ["/music/Example Artist/Example Album/01 - Example.flac"], sourceRate: 44_100 });

  await page.getByRole("button", { name: /^Fix/ }).click();
  await sheet(page)
    .getByRole("button", { name: /another modulator/ })
    .click();
  await expect(sheet(page).getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet(page).getByRole("button", { name: /^AHM7EC8B/ })).toContainText("won't play");
  await shot(page, "advice-4-wedge");

  await sheet(page)
    .getByRole("button", { name: /^ASDM7EC-fast Gen/ })
    .click();
  await expect(row(page, "Modulator")).toContainText("ASDM7EC-fast");
  await expect(page.locator("p", { hasText: /won't start/ })).toBeHidden();
});
