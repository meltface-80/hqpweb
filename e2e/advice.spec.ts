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

test("modulators: grouped list, then the guide's answers and its rate-and-modulator pairs", async ({ page }) => {
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
  // The intro: in full the first time; one line after "Got it".
  await expect(sheet(page)).toContainText("No set of rules");
  await sheet(page).getByRole("button", { name: "Got it" }).click();
  await expect(sheet(page).getByRole("button", { name: "About this guide" })).toBeVisible();
  await expect(sheet(page).getByText("A place to start, not the last word")).toBeVisible();
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
  // Rate and modulator as pairs: DSD512 suits an older ESS chip, fifth order.
  const pair = (label: RegExp) => sheet(page).locator("li.pair", { hasText: label });
  await expect(pair(/^DSD512 · ASDM5EC-fast/)).toContainText("Suits your DAC");
  await expect(pair(/^DSD512 · ASDM5EC-fast/)).toContainText("For your answers");
  await shot(page, "advice-2-guide");

  // Use: the pair applies as one change.
  await pair(/^DSD512 · ASDM5EC-fast/)
    .getByRole("button", { name: "Use" })
    .click();
  await expect(row(page, "Modulator")).toContainText("ASDM5EC-fast");
  await expect(pair(/^DSD512 · ASDM5EC-fast/)).toContainText("Now using");
  // No A/B in this version: it's a feature for later.
  await expect(sheet(page).getByRole("button", { name: /^A\/B/ })).toHaveCount(0);

  // The variants carry what Signalyst has said about each: CPU load and character.
  await expect(sheet(page)).toContainText("CPU: lightest");

  // DSD1024 with AHM is one change: rate and modulator together, and back down again.
  await pair(/^DSD1024 · AHM5EC8B/)
    .getByRole("button", { name: "Use" })
    .click();
  await expect(page.locator(".headline .big")).toHaveText("DSD1024");
  await expect(row(page, "Modulator")).toContainText("AHM5EC8B");
  await pair(/^DSD256 · ASDM5EC-fast/)
    .getByRole("button", { name: "Use" })
    .click();
  await expect(page.locator(".headline .big")).toHaveText("DSD256");
  await expect(row(page, "Modulator")).toContainText("ASDM5EC-fast");
  await shot(page, "advice-2b-pairs");

  // Answers outlive the page; the guide tab is remembered; Change reopens in place.
  await page.reload();
  await row(page, "Modulator").click();
  await expect(sheet(page).getByRole("tab", { name: "Guide" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet(page)).not.toContainText("No set of rules"); // the intro stays one line
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

  // Search reaches into folded sections; "Works here" hides what won't play.
  await sheet(page).getByRole("searchbox").fill("ecv3");
  await expect(sheet(page).getByRole("button", { name: /^ASDM7ECv3/ })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: /^AHM7EC8B/ })).toBeHidden();
  await sheet(page).getByRole("searchbox").fill("");
  await sheet(page).getByRole("button", { name: "Only what plays here" }).click();
  await expect(sheet(page).getByRole("button", { name: /^AHM5EC8B/ })).toBeHidden();
  await sheet(page).getByRole("button", { name: "Only what plays here" }).click();

  await sheet(page)
    .getByRole("button", { name: /^ASDM7EC-fast Gen/ })
    .click();
  await expect(row(page, "Modulator")).toContainText("ASDM7EC-fast");
  await expect(page.locator("p", { hasText: /won't start/ })).toBeHidden();
});

test("a rate the modulator can't play at, or a modulator the rate can't take, offers the pair", async ({ page }) => {
  await openOn(page, "pairnet");
  await expect(row(page, "Modulator")).toContainText("AHM7EC8B");

  // Advanced: DSD256 with AHM can't play, so the rate goes with ASDM7EC-fast, as one change.
  await page.locator("summary", { hasText: "Advanced" }).click();
  await row(page, "Output rate").click();
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await sheet(page)
    .getByRole("button", { name: /^DSD256/ })
    .click();
  await expect(row(page, "Modulator")).toContainText("ASDM7EC-fast");
  await expect(row(page, "Output rate")).toContainText("DSD256");
  expect(asked).toContain("together");

  // The List: AHM at DSD256 can't play, so picking it offers DSD1024 with it.
  await row(page, "Modulator").click();
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await sheet(page)
    .getByRole("button", { name: /^AHM7EC8B/ })
    .click();
  await expect(row(page, "Output rate")).toContainText("DSD1024");
  await expect(row(page, "Modulator")).toContainText("AHM7EC8B");
  expect(asked).toContain("DSD1024");
});

test("the sheet scrolls to its end; a DAC that converts DSD still gets DSD choices, and Switch to PCM", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await openOn(page, "scroll");
  await row(page, "Modulator").click();
  await sheet(page).getByRole("tab", { name: "Guide" }).click();
  const body = sheet(page).locator(".body");
  // The content is taller than the sheet, and scrolling the body reaches the end.
  const reach = await body.evaluate((el) => {
    const tall = el.scrollHeight > el.clientHeight + 10;
    el.scrollTop = el.scrollHeight;
    return { tall, moved: el.scrollTop > 0, bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2 };
  });
  expect(reach).toEqual({ tall: true, moved: true, bottom: true });

  // No dead end: "converts" suggests PCM, and still offers the DSD pairs.
  await step(page, "Your DAC")
    .getByRole("button", { name: /^It converts/ })
    .click();
  await expect(sheet(page).locator("li.pair").first()).toBeHidden(); // folded away under PCM
  await sheet(page).getByText("Staying in DSD?").click();
  await expect(sheet(page).locator("li.pair").first()).toBeVisible();
  await expect(sheet(page)).not.toContainText("Suits your DAC");
  await sheet(page).getByRole("button", { name: "Switch to PCM" }).click();
  await expect(row(page, "Dither")).toBeVisible();
});

test("HQPlayer falling behind raises the alarm; a rollback from the guide is reported in the sheet", async ({ page }) => {
  await openOn(page, "behind");
  await expect(page.locator(".banner", { hasText: /falling behind/ })).toBeVisible();

  // A pick from the guide that can't keep up is rolled back, and the sheet says so.
  await row(page, "Modulator").click();
  await sheet(page).getByRole("tab", { name: "Guide" }).click();
  await step(page, "Your DAC")
    .getByRole("button", { name: /^DSD goes straight/ })
    .click();
  await sheet(page).locator("li.row").getByRole("button", { name: "Use" }).first().click();
  await expect(sheet(page).locator(".msg.result")).toContainText(/rolled back/i, { timeout: 10_000 });
});

test("HQPlayer that stops answering gets restart steps", async ({ page }) => {
  await openOn(page, "down");
  await poke("down", { down: true });
  const banner = page.locator(".banner", { hasText: /unreachable/ });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await banner.locator("summary").click();
  await expect(banner).toContainText("Quit HQPlayer");
  await expect(banner).toContainText("saved settings");
  // What's shown is HQPlayer's last known state: dimmed, and nothing in it can be pressed.
  await expect(page.locator("div.live")).toHaveAttribute("inert", "");
  await shot(page, "advice-5-down");
});
