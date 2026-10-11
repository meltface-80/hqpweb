// Roon, both ways (as api-contract.test.ts does for the core): over HTTP (the web app's
// httpApi against the server) and in-process (localApi plus localRoonApi, as the phone app
// wires them). Same calls, same refusals, same status events: the page can't tell.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeHqp, FakeRoon, loadProfile } from "@app/fake-hqp";
import type { Api, RoonStatus, RoonZone } from "@app/contract";
import { RoonLink, Service, localApi, localRoonApi } from "@app/core";
import { discover, nodeConnect } from "@app/protocol/node";
import { buildApp } from "../apps/server/src/app.ts";
import { httpApi } from "../apps/web/src/lib/api.ts";
import { NodeEventSource } from "./sse.ts";

type RoonPart = Pick<
  Api,
  | "instances"
  | "addInstance"
  | "removeInstance"
  | "status"
  | "roon"
  | "configureRoon"
  | "setRoonZone"
  | "roonSeek"
  | "roonTransport"
  | "roonArtUrl"
>;

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

let fake: FakeHqp;
let core: FakeRoon;
let corePort: number;
let roon: RoonLink;
let done: (() => unknown)[] = [];
afterEach(async () => {
  for (const d of done.splice(0).reverse()) await d();
  roon.close();
  await core.close();
  await fake.close();
});

const config = () => ({ instances: [{ id: "hq", name: "HQ", host: "127.0.0.1", port: fake.port }] });

const ways: [string, () => Promise<{ api: RoonPart; base: string }>][] = [
  [
    "over HTTP",
    async () => {
      const app = buildApp(config() as never, { roon, pollMs: 50 });
      const base = await app.listen(0, "127.0.0.1");
      done.push(() => app.close());
      return { api: httpApi({ base, EventSource: NodeEventSource as unknown as typeof EventSource }), base };
    },
  ],
  [
    "in-process",
    async () => {
      const service = new Service(config() as never, { net: { connect: nodeConnect, discover } });
      done.push(() => service.close());
      return { api: { ...localApi(service, { roon }), ...localRoonApi(roon, service) }, base: "" };
    },
  ],
];

describe.each(ways)("Roon %s", (_way, start) => {
  let api: RoonPart;
  let base: string;
  beforeEach(async () => {
    fake = new FakeHqp(loadProfile("desktop5-linux-pcm"), { timeScale: 0 });
    await fake.listen();
    core = new FakeRoon();
    corePort = await core.listen();
    roon = new RoonLink(null, { reconnectMs: 50, replyMs: 1000 });
    ({ api, base } = await start());
  });

  /** The words a refusal carries (all the HTTP client keeps). */
  const refused = (p: Promise<unknown>) =>
    p.then(
      () => "accepted",
      (e: Error) => e.message,
    );

  /** Switched on, approved in Roon, and its zones listed. */
  async function paired() {
    expect((await api.configureRoon({ enabled: true, host: "127.0.0.1", port: corePort })).enabled).toBe(true);
    await until(() => core.waiting().length === 1);
    core.approve();
    await until(() => roon.view().zones.length === 2);
  }

  it("is off until switched on, and says so", async () => {
    expect(await api.roon()).toMatchObject({ enabled: false, status: "off" });
    expect(await refused(api.roonTransport("hq", "next"))).toBe("no Roon zone for this instance (Settings → Roon)");
  });

  it("refuses the same bad requests", async () => {
    expect(await refused(api.configureRoon({ enabled: "yes" } as never))).toBe("enabled must be a boolean");
    expect(await refused(api.configureRoon({ enabled: true, extra: 1 } as never))).toBe('unknown field "extra"');
    expect(await refused(api.setRoonZone("hq", 5 as never))).toBe("zone must be a Roon zone id or null");
    expect(await refused(api.roonSeek("hq", -1))).toBe("seconds must be a number ≥ 0");
    expect(await refused(api.roonTransport("hq", "stop" as never))).toMatch(/^action must be one of play/);
    expect(await refused(api.roonTransport("nope", "play"))).toBe("unknown instance");
    expect(await refused(api.setRoonZone("nope", null))).toBe("unknown instance");
  });

  it("maps a zone, controls it, and the status stream follows it", async () => {
    await paired();
    expect((await api.setRoonZone("hq", "zone-hqp")).zoneFor).toEqual({ hq: "zone-hqp" });

    const events: { status: RoonStatus; zone: RoonZone | null }[] = [];
    const off = api.status("hq", { now: () => {}, unreachable: () => {}, roon: (e) => events.push(e) });
    done.push(off);
    await until(() => events.length === 1);
    expect(events[0]).toMatchObject({ status: "connected", zone: { name: "Listening Room", state: "playing" } });
    expect(events[0]!.zone?.nowPlaying?.seek).toBe(12);

    await api.roonTransport("hq", "pause");
    await until(() => events.length === 2);
    expect(events[1]!.zone?.state).toBe("paused");
    // A seek is a jump: sent though nothing else changed.
    await api.roonSeek("hq", 200);
    await until(() => events.length === 3);
    expect(events[2]!.zone?.nowPlaying?.seek).toBe(200);
  });

  // A page subscribes inside a reactive effect (App.svelte): an event delivered during the call
  // becomes part of that effect, and a Svelte page loops until it gives up (the phone app went
  // blank once Roon was on). Over HTTP nothing can arrive during the call; in-process mustn't either.
  it("delivers nothing during the subscribe call, not even Roon's current zone", async () => {
    await paired();
    await api.setRoonZone("hq", "zone-hqp");
    const during: string[] = [];
    let subscribing = true;
    const note = (what: string) => () => void (subscribing && during.push(what));
    const off = api.status("hq", { now: note("now"), unreachable: note("unreachable"), roon: note("roon") });
    subscribing = false;
    done.push(off);
    expect(during).toEqual([]);
    // And the zone does come, just after.
    let zone: RoonZone | null = null;
    const off2 = api.status("hq", { now: () => {}, unreachable: () => {}, roon: (e) => (zone = e.zone) });
    done.push(off2);
    await until(() => zone !== null);
  });

  it("loads the track's art from the URL it gives", async () => {
    await paired();
    await api.setRoonZone("hq", "zone-hqp");
    const url = api.roonArtUrl("img1", 100);
    const res = await fetch(url.startsWith("/") ? base + url : url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("forgets a removed instance's zone", async () => {
    await paired();
    const { id } = await api.addInstance({ name: "Extra", host: "127.0.0.1", port: 1 });
    await api.setRoonZone(id, "zone-hqp");
    expect(roon.view().zoneFor[id]).toBe("zone-hqp");
    await api.removeInstance(id);
    expect(roon.view().zoneFor[id]).toBeUndefined();
  });
});
