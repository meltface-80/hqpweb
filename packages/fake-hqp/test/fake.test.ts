import { afterEach, describe, expect, it } from "vitest";
import { HqpClient, cmd, rawRequest } from "@app/protocol";
import { FakeHqp, loadProfile } from "../src/index.ts";

let fake: FakeHqp | undefined;
/** The fake's clock, in ms: tests advance it rather than wait. */
let clock = 1_000_000;
const until = async (cond: () => boolean, ms = 3000) => {
  for (const t0 = Date.now(); !cond(); await new Promise((r) => setTimeout(r, 10)))
    if (Date.now() - t0 > ms) throw new Error("timed out");
};
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function start(profile = "desktop5-mac-sdm") {
  fake = new FakeHqp(loadProfile(profile), { timeScale: 0, now: () => clock });
  const { port } = await fake.listen();
  return new HqpClient("127.0.0.1", { port, timeoutMs: 2000 });
}

const byName = <T extends { name: string; index: number }>(list: T[], name: string) => {
  const hit = list.find((x) => x.name === name);
  if (!hit) throw new Error(`${name} not in list`);
  return hit.index;
};

describe("reads (Mac SDM profile)", () => {
  it("serves the captured lists and state", async () => {
    const c = await start();
    expect((await c.filters()).length).toBe(77);
    expect((await c.shapers()).length).toBe(36);
    expect((await c.rates()).map((r) => r.rate)).toEqual([0, 2822400, 5644800, 11289600, 22579200, 45158400]);
    const s = await c.state();
    expect(s).toMatchObject({ mode: 2, activeMode: 1, filterNx: 51, filter1x: 49, shaper: 35, volume: -22, state: 2 });
    const st = await c.status();
    expect(st).toMatchObject({ activeMode: "SDM (DSD)", activeRate: 45158400, activeShaper: "AHM7EC8B" });
  });

  it("uses the 1x filter for a 44.1 kHz source and the Nx filter for 96 kHz (measured)", async () => {
    const c = await start();
    expect((await c.status()).activeFilter).toBe("poly-sinc-gauss-xla");
    expect((await c.state()).filterInUse).toBe(49);
    fake!.setSource(96_000);
    expect((await c.status()).source?.sampleRate).toBe(96_000);
    expect((await c.status()).activeFilter).toBe("poly-sinc-gauss-hires-lp");
    expect((await c.state()).filterInUse).toBe(51);
  });

  it("answers several requests on one connection, in order", async () => {
    await start();
    const port = fake!.port;
    const net = await import("node:net");
    const replies = await new Promise<string[]>((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      let buf = "";
      s.on("data", (d) => {
        buf += d;
        const lines = buf.split("\n").filter(Boolean);
        if (lines.length === 2) {
          s.destroy();
          resolve(lines);
        }
      });
      s.write('<?xml version="1.0" encoding="UTF-8"?><GetInfo/>\n<?xml version="1.0" encoding="UTF-8"?><VolumeRange/>\n');
    });
    expect(replies[0]).toContain("<GetInfo");
    expect(replies[1]).toContain('max="-3"');
  });
});

describe("measured reply quirks", () => {
  it("Set20kFilter and SetAdaptiveVolume reply without result, yet apply", async () => {
    const c = await start();
    expect(await c.send(cmd.set20kFilter(true))).toEqual({ kind: "none" });
    expect(await c.send(cmd.setAdaptiveVolume(true))).toEqual({ kind: "none" });
    expect(await c.state()).toMatchObject({ filter20k: true, adaptive: true });
  });

  it("convolution says OK but nothing changes", async () => {
    const c = await start();
    expect(await c.send(cmd.setConvolution(true))).toEqual({ kind: "ok" });
    expect((await c.state()).convolution).toBe(false);
  });

  it("unknown commands, v6-only commands and ConfigurationLoad are errors", async () => {
    const c = await start();
    expect(await c.send('<SetFilter20k value="1"/>')).toEqual({ kind: "error", message: "Unknown command" });
    expect(await c.send("<GetJunkFilters/>")).toEqual({ kind: "error", message: "Unknown command" });
    expect(await c.send('<ConfigurationLoad value="Example configuration 1"/>')).toEqual({
      kind: "error",
      message: "missing data or not authorized",
    });
  });

  it("out-of-range indices say OK and change nothing (inferred, hostile)", async () => {
    const c = await start();
    expect(await c.send(cmd.setShaping(999))).toEqual({ kind: "ok" });
    expect((await c.state()).shaper).toBe(35);
  });
});

describe("volume", () => {
  it("keeps fractional dB", async () => {
    const c = await start();
    await c.send(cmd.volume(-30.5));
    expect((await c.state()).volume).toBe(-30.5);
  });
  it("uses the long float format on the Linux profile", async () => {
    await start("desktop5-linux-pcm");
    const raw = await rawRequest("127.0.0.1", fake!.port, cmd.state(), 2000);
    expect(raw).toContain('volume="-28.00000000000000000"');
  });
});

describe("mode change", () => {
  it("swaps every list and restores each mode's remembered settings", async () => {
    const c = await start();
    const modes = await c.modes();
    await c.send(cmd.setMode(byName(modes, "PCM")));
    const pcm = await c.state();
    expect(pcm.activeMode).toBe(0);
    expect((await c.filters()).length).toBe(67);
    expect((await c.shapers()).length).toBe(10);
    expect((await c.rates()).length).toBe(13);
    // Same filter name, different index per mode (measured): resolve by name.
    const pcmIdx = byName(await c.filters(), "poly-sinc-gauss-hires-lp");
    expect(pcmIdx).toBe(40);

    await c.send(cmd.setMode(byName(modes, "SDM (DSD)")));
    expect(await c.state()).toMatchObject({ filterNx: 51, filter1x: 49, shaper: 35, state: 2 });
  });

  it("resets the rate to auto (reported for Embedded, unmeasured on Desktop)", async () => {
    const c = await start();
    const asdm = byName(await c.shapers(), "ASDM7EC");
    await c.send(cmd.setShaping(asdm));
    await c.send(cmd.setRate((await c.rates()).find((r) => r.rate === 22579200)!.index));
    const modes = await c.modes();
    await c.send(cmd.setMode(byName(modes, "PCM")));
    await c.send(cmd.setMode(byName(modes, "SDM (DSD)")));
    expect((await c.state()).rate).toBe(0);
  });
});

describe("invalid rate/modulator combination (measured)", () => {
  it("with Roon as the source: replies OK, stops, ignores Play, and resumes by itself once the rate is valid", async () => {
    const c = await start();
    const rates = await c.rates();
    const dsd512 = rates.find((r) => r.rate === 22579200)!.index;
    const auto = rates.find((r) => r.rate === 0)!.index;

    expect(await c.send(cmd.setRate(dsd512))).toEqual({ kind: "ok" });
    expect((await c.status()).state).toBe(0);

    await c.send("<Play/>");
    expect((await c.status()).state).toBe(0);

    await c.send(cmd.setRate(auto));
    expect((await c.status()).state).toBe(2);
  });

  // Measured 2026-10-04 (Desktop 5.35.10, Linux): playing from HQPlayer's own playlist,
  // a stop at an incompatible ratio doesn't resume when the rate is fixed. Play alone then
  // reports state 2 but the position doesn't move; Stop, then Play, resumed it once and
  // failed once. The fake lets Stop-then-Play resume, so hqpweb's Restart button can be tested.
  it("with its own playlist as the source: after the fix, Play alone is stuck; Stop then Play resumes", async () => {
    const c = await start("desktop5-linux-pcm");
    fake!.feeder = "playlist";
    fake!.playlist = ["/music/Example Artist/Example Album/01 - Example.flac"];
    fake!.playback = 2;
    const rates = await c.rates();
    const at = (hz: number) => rates.find((r) => r.rate === hz)!.index;
    await c.send(cmd.setRate(at(176_400))); // first: Auto here is 384 kHz, which sinc-M can't do
    await c.send(cmd.setFilter((await c.state()).filterNx, byName(await c.filters(), "sinc-M")));
    expect((await c.status()).state).toBe(2);

    await c.send(cmd.setRate(at(192_000))); // 4.35×: sinc-M can't
    await c.send(cmd.setRate(at(176_400)));
    expect((await c.status()).state).toBe(0);

    const advances = async () => {
      const p0 = (await c.status()).position;
      clock += 300;
      return (await c.status()).position > p0;
    };
    await c.send(cmd.play());
    expect((await c.status()).state).toBe(2);
    expect(await advances()).toBe(false);

    await c.send(cmd.stop());
    await c.send(cmd.play());
    expect(await advances()).toBe(true);
  });

  it("a valid combination at DSD512 keeps playing", async () => {
    const c = await start();
    const asdm = byName(await c.shapers(), "ASDM7EC");
    await c.send(cmd.setShaping(asdm));
    const dsd512 = (await c.rates()).find((r) => r.rate === 22579200)!.index;
    await c.send(cmd.setRate(dsd512));
    expect(await c.status()).toMatchObject({ state: 2, activeRate: 22579200, activeShaper: "ASDM7EC" });
  });
});

describe("persistent client connection", () => {
  it("reuses one connection for many requests", async () => {
    const c = await start();
    await c.state();
    await Promise.all([c.status(), c.filters(), c.shapers(), c.volumeRange()]);
    await c.send(cmd.volume(-30));
    expect(c.connections).toBe(1);
    expect(fake!.connections).toBe(1);
    c.close();
  });

  it("reconnects transparently when the server closed an idle connection", async () => {
    fake = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0, idleTimeoutMs: 50 });
    const { port } = await fake.listen();
    const c = new HqpClient("127.0.0.1", { port, timeoutMs: 2000 });
    await c.state();
    await until(() => fake!.sockets.size === 0); // the fake closed it after 50 ms idle
    expect((await c.state()).volume).toBe(-22);
    expect(c.connections).toBe(2);
    c.close();
  });

  it("fails cleanly when nothing is listening", async () => {
    const c = new HqpClient("127.0.0.1", { port: 1, timeoutMs: 1000 });
    await expect(c.state()).rejects.toThrow();
  });
});
