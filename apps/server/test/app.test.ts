import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeHqp, loadProfile } from "@app/fake-hqp";
import { buildApp } from "../src/app.ts";

const fake = new FakeHqp(loadProfile("desktop5-linux-pcm"), { timeScale: 0 });
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  await fake.listen();
  app = buildApp({
    instances: [
      { id: "fake", name: "Fake", host: "127.0.0.1", port: fake.port },
      { id: "gone", name: "Gone", host: "127.0.0.1", port: 1 },
    ],
  });
});
afterAll(async () => {
  await app.close();
  await fake.close();
});

describe("api", () => {
  it("lists instances without exposing hosts", async () => {
    const r = await app.inject("/api/instances");
    expect(r.json()).toEqual([
      { id: "fake", name: "Fake" },
      { id: "gone", name: "Gone" },
    ]);
  });

  it("returns info, state and status", async () => {
    const r = await app.inject("/api/instances/fake/now");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ info: { engine: "5.35.10" }, state: { volume: -28 }, status: { activeMode: "PCM" } });
  });

  it("maps an unreachable instance to 502 and an unknown id to 404", async () => {
    expect((await app.inject("/api/instances/gone/now")).statusCode).toBe(502);
    expect((await app.inject("/api/instances/nope/now")).statusCode).toBe(404);
  });
});
