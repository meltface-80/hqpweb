import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";
import { client } from "./http.ts";

let fake: FakeHqp;
let app: ReturnType<typeof buildApp>;
let req: ReturnType<typeof client>;
let base: string;

beforeEach(async () => {
  fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0 });
  await fake.listen();
  app = buildApp({ instances: [{ id: "mac", name: "Mac", host: "127.0.0.1", port: fake.port }] }, { pollMs: 50 });
  base = await app.listen(0, "127.0.0.1");
  req = client(base);
});
afterEach(async () => {
  await app.close();
  await fake.close();
});

const quick = (body: object) => req("POST", "/api/instances/mac/quick", { body });
const undo = () => req("POST", "/api/instances/mac/undo");

describe("capabilities", () => {
  it("returns the current mode's lists and volume range", async () => {
    const r = (await req("GET", "/api/instances/mac/capabilities")).json();
    expect(r.mode.name).toBe("SDM (DSD)");
    expect(r.filters).toHaveLength(77);
    expect(r.shapers).toHaveLength(36);
    expect(r.volumeRange).toMatchObject({ min: -60, max: -3 });
  });

  it("follows a mode change made elsewhere", async () => {
    await req("GET", "/api/instances/mac/capabilities");
    fake.modeIndex = 1; // PCM, as if changed from HQPlayer's own UI
    const r = (await req("GET", "/api/instances/mac/capabilities")).json();
    expect(r.mode.name).toBe("PCM");
    expect(r.shapers).toHaveLength(10);
  });
});

describe("quick changes", () => {
  it("resolves names, applies, and verifies by reading State back", async () => {
    const r = await quick({ filterNx: "poly-sinc-gauss-long", shaper: "ASDM7EC" });
    expect(r.status).toBe(200);
    const body = r.json();
    expect(body.results).toEqual([
      expect.objectContaining({ field: "filterNx", requested: "poly-sinc-gauss-long", actual: "poly-sinc-gauss-long", applied: true }),
      expect.objectContaining({ field: "shaper", requested: "ASDM7EC", actual: "ASDM7EC", applied: true }),
    ]);
    // The 1x filter is carried over untouched.
    expect(body.state.filter1x).toBe(49);
  });

  it("reports applied=false when the reply says OK but nothing changed", async () => {
    fake.ignore.add("SetShaping");
    const body = (await quick({ shaper: "ASDM7EC" })).json();
    expect(body.results[0]).toMatchObject({ applied: false, actual: "AHM7EC8B", reply: { kind: "ok" } });
  });

  it("verifies toggles whose replies carry no result", async () => {
    const body = (await quick({ filter20k: true, adaptive: true, invert: true })).json();
    expect(body.results.every((x: { applied: boolean }) => x.applied)).toBe(true);
    expect(body.results.find((x: { field: string }) => x.field === "filter20k").reply).toEqual({ kind: "none" });
  });

  it("rejects names that don't exist in the current mode, and applies nothing", async () => {
    const r = await quick({ shaper: "NS5", filterNx: "poly-sinc-gauss-long" }); // NS5 is a PCM dither
    expect(r.status).toBe(422);
    expect(r.json().error).toMatch(/NS5.*SDM/);
    expect(fake.rem.filterNx).toBe(51);
  });

  it("rejects unknown fields and empty bodies", async () => {
    expect((await quick({})).status).toBe(400);
    expect((await quick({ rate: 3 })).status).toBe(400);
    expect((await quick({ volume: "-20" })).status).toBe(400);
  });
});

describe("volume safety", () => {
  it("lowers freely, as a float", async () => {
    const body = (await quick({ volume: -40.5 })).json();
    expect(body.results[0]).toMatchObject({ applied: true, actual: -40.5 });
  });

  it("refuses a raise of more than 6 dB in one step", async () => {
    const r = await quick({ volume: -10 }); // from -22
    expect(r.status).toBe(422);
    expect(fake.volume).toBe(-22);
  });

  it("allows a raise of up to 6 dB", async () => {
    expect((await quick({ volume: -16 })).json().results[0].applied).toBe(true);
  });

  it("clamps to VolumeRange.max and says so", async () => {
    fake.volume = -5;
    const res = (await quick({ volume: 0 })).json().results[0];
    expect(res).toMatchObject({ actual: -3, applied: true });
    expect(res.note).toMatch(/clamped to -3/);
  });
});

describe("undo", () => {
  it("restores exactly the fields the last change touched", async () => {
    await quick({ filter1x: "poly-sinc-gauss-long", volume: -30 });
    const body = (await undo()).json();
    expect(body.state).toMatchObject({ filter1x: 49, filterNx: 51, volume: -22 });
    expect(body.undoAvailable).toBe(false);
  });

  it("does not raise volume past the guard if it was changed elsewhere since", async () => {
    await quick({ volume: -40 });
    fake.volume = -45; // e.g. lowered from Roon
    const body = (await undo()).json();
    expect(body.results[0]).toMatchObject({ field: "volume", applied: false });
    expect(body.results[0].note).toMatch(/not restored/);
    expect(fake.volume).toBe(-45);
  });

  it("refuses after a mode change", async () => {
    await quick({ shaper: "ASDM7EC" });
    fake.modeIndex = 1;
    expect((await undo()).status).toBe(409);
  });

  it("has nothing to undo at first", async () => {
    expect((await undo()).status).toBe(409);
  });
});

describe("events", () => {
  it("streams status snapshots", async () => {
    const addr = base;
    const ctl = new AbortController();
    const res = await fetch(`${addr}/api/instances/mac/events`, { signal: ctl.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: now")) text += new TextDecoder().decode((await reader.read()).value);
    ctl.abort();
    const data = JSON.parse(text.split("event: now\ndata: ")[1]!.split("\n")[0]!);
    expect(data.status.activeShaper).toBe("AHM7EC8B");
  });

  it("404s for an unknown instance", async () => {
    expect((await req("GET", "/api/instances/nope/events")).status).toBe(404);
  });
});
