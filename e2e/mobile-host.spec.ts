// The phone app's page (apps/mobile), in a browser: the core in-process, and the page hiding
// what this host can't do (apps/web api.ts can). The native TCP plugin isn't here, so there's
// no HQPlayer: this checks the host's shape, not playback (that's checked on the simulator).
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../apps/mobile/dist/", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
let server: Server;
let base: string;

test.beforeAll(async () => {
  server = createServer((q, r) => {
    const reply = (status: number, body?: Buffer, type?: string) => {
      r.writeHead(status, type ? { "content-type": type } : {});
      r.end(body);
    };
    // Only files inside the build: a path that resolves outside it (../) is refused.
    let file: string;
    try {
      const path = decodeURIComponent(new URL(q.url ?? "/", "http://x").pathname);
      file = resolve(ROOT, "." + (path.endsWith("/") ? path + "index.html" : path));
    } catch {
      return reply(400);
    }
    if (!file.startsWith(resolve(ROOT) + sep)) return reply(403);
    readFile(file).then(
      (body) => reply(200, body, TYPES[extname(file)] ?? "application/octet-stream"),
      () => reply(404),
    );
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
test.afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

test("the app hides what it can't do: the restart cap, lining up by ear, scanning, finding Roon", async ({ page }) => {
  await page.goto(base);
  await expect(page.locator(".brand")).toHaveText("hqpmob");
  await expect(page.locator(".banner")).toContainText("add one by address");
  await expect(page.locator(".banner")).not.toContainText("scan");

  await page.getByRole("button", { name: /settings/i }).click();
  const tabs = page.getByRole("tablist");
  await expect(tabs.getByRole("tab", { name: "HQPlayer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan now" })).toHaveCount(0);

  // Roon is here, with its core's address typed in: finding it is multicast, which the app can't do.
  await tabs.getByRole("tab", { name: "Roon" }).click();
  await page.getByRole("switch").click();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find" })).toHaveCount(0);

  await tabs.getByRole("tab", { name: "Listening" }).click();
  await expect(page.getByText("Volume buttons")).toBeVisible();
  await expect(page.getByText(/after HQPlayer restarts/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Line up by ear…" })).toHaveCount(0);
});

test("the test's own file server stays inside the build", async () => {
  // An encoded slash survives URL parsing and becomes ../ only once decoded: the case to refuse.
  expect((await fetch(`${base}..%2fpackage.json`)).status).toBe(403);
  expect((await fetch(`${base}index.html`)).status).toBe(200);
});
