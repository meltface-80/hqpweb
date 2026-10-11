import { describe, expect, it } from "vitest";
import type { Api } from "@app/contract";
import { SERVER_CAN, api, can, httpApi, useHost, appName } from "./api.ts";

/** A fetch that records what it was asked and answers `reply`. */
function recorder(reply: unknown = {}, status = 200) {
  const asked: { url: string; method: string; body: unknown }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    asked.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return new Response(JSON.stringify(reply), { status });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

/** An EventSource the test drives. */
class FakeSource {
  static last: FakeSource;
  readonly url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private handlers = new Map<string, (e: { data: string }) => void>();
  constructor(url: string) {
    this.url = url;
    FakeSource.last = this;
  }
  addEventListener(name: string, fn: (e: { data: string }) => void) {
    this.handlers.set(name, fn);
  }
  emit(name: string, data: unknown) {
    this.handlers.get(name)?.({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

describe("the API over HTTP", () => {
  it("asks the same paths, methods and bodies as before", async () => {
    const { fetch, asked } = recorder();
    const api = httpApi({ base: "http://192.0.2.1:4380", fetch });
    await api.change("mac", { volume: -30 });
    await api.selectDac("mac", "desk");
    await api.forgetCombo("mac", { mode: "PCM", rateHz: 384000, filterNx: "a", filter1x: "b", shaper: "NS9" });
    await api.setRestartCap("a b", null);
    expect(asked).toEqual([
      { url: "http://192.0.2.1:4380/api/instances/mac/change", method: "POST", body: { volume: -30 } },
      { url: "http://192.0.2.1:4380/api/instances/mac/dac", method: "PUT", body: { dac: "desk" } },
      {
        url: "http://192.0.2.1:4380/api/instances/mac/forget",
        method: "POST",
        body: { mode: "PCM", rateHz: 384000, filter1x: "b", filterNx: "a", shaper: "NS9" },
      },
      { url: "http://192.0.2.1:4380/api/instances/a%20b/restartcap", method: "PUT", body: { maxDb: null } },
    ]);
  });

  it("turns an error answer into an Error with the server's words", async () => {
    const { fetch } = recorder({ error: '"volume" must be a number' }, 400);
    await expect(httpApi({ fetch }).change("mac", { volume: -1 })).rejects.toThrow('"volume" must be a number');
  });

  it("hands each stream event to its handler, and stops when told", () => {
    const api = httpApi({ EventSource: FakeSource as unknown as typeof EventSource });
    const seen: string[] = [];
    const stop = api.status("mac", {
      now: (s) => seen.push(`now ${s.state.volume}`),
      unreachable: (error) => seen.push(`unreachable ${error}`),
      roon: (r) => seen.push(`roon ${r.zone?.name}`),
      lost: () => seen.push("lost"),
    });
    const es = FakeSource.last;
    expect(es.url).toBe("/api/instances/mac/events");
    es.emit("now", { state: { volume: -31 }, status: {} });
    es.emit("unreachable", { error: "connection refused" });
    es.emit("roon", { status: "connected", zone: { name: "LR" } });
    es.onerror?.();
    stop();
    expect(seen).toEqual(["now -31", "unreachable connection refused", "roon LR", "lost"]);
    expect(es.closed).toBe(true);
  });

  it("gives the meter's frames to its handler", () => {
    const api = httpApi({ EventSource: FakeSource as unknown as typeof EventSource });
    const frames: boolean[] = [];
    const stop = api.meter("mac", (m) => frames.push(m.live));
    FakeSource.last.emit("meter", { live: true, connected: true });
    stop();
    expect([FakeSource.last.url, frames, FakeSource.last.closed]).toEqual(["/api/instances/mac/meter", [true], true]);
  });
});

describe("the host", () => {
  it("is the server unless a host says otherwise: HTTP, and everything on offer", () => {
    expect(can).toEqual({ restartCap: true, calibrate: true, roon: true, discover: true });
    expect(can).toBe(SERVER_CAN);
    expect(appName).toBe("hqpweb");
  });
  it("a host's API, abilities and name reach every module that imported them (live bindings)", async () => {
    const appApi = { instances: async () => [] } as unknown as Api;
    useHost({ api: appApi, can: { restartCap: false, calibrate: false, roon: false, discover: false }, name: "hqpmob" });
    expect(api).toBe(appApi);
    expect(can.roon).toBe(false);
    expect(appName).toBe("hqpmob");
    expect(await api.instances()).toEqual([]);
    useHost({ api: httpApi(), can: SERVER_CAN, name: "hqpweb" }); // as it was, for the other tests
  });
});
