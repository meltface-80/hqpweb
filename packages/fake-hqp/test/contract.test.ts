// The fake's contract with the real HQPlayer (docs/quality-plan.md, "Fake contract tests").
// 1. Shape: its replies match replies recorded from real instances (test/recorded/, read-only
//    captures 2026-10-04, Desktop 5.35.10 on Linux and on macOS, instance names replaced).
// 2. The behaviours hqpweb's safety rules rely on, each with its evidence cited. Where the
//    fake goes beyond what was measured, its code says "Inferred".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument, predictedStop, type Element } from "@app/protocol";
import { FakeHqp, defaultIncompatible, loadProfile, type ProfileId } from "../src/index.ts";
import { STOP_RULES } from "../src/stops.ts";

const recorded = (platform: string, command: string) =>
  parseDocument(readFileSync(new URL(`recorded/${platform}/${command}.xml`, import.meta.url), "utf8"));
async function fakeReply(fake: FakeHqp, command: string): Promise<Element> {
  const body = command === "Status" ? `<${command} subscribe="0"/>` : `<${command}/>`;
  return parseDocument(await fake.handle(`<?xml version="1.0" encoding="utf-8"?>${body}`));
}
const stopped = (profile: ProfileId) => {
  const f = new FakeHqp(loadProfile(profile), { timeScale: 0 });
  f.playback = 0; // the recordings were taken while stopped
  return f;
};

/**
 * Status attributes the real HQPlayer sends and the fake leaves out. hqpweb reads none
 * of them (checked below), so the fake doesn't need them.
 */
const NOT_READ_BY_HQPWEB = [
  "begin_min",
  "begin_sec",
  "correction",
  "display_position",
  "input_fill",
  "min",
  "output_delay",
  "output_fill",
  "queued",
  "random",
  "remain_min",
  "remain_sec",
  "repeat",
  "sec",
  "total_min",
  "total_sec",
  "track_serial",
  "transport_serial",
];

describe.each([
  ["linux", "desktop5-linux-pcm"],
  ["mac", "desktop5-mac-sdm"],
] as const)("replies match a real %s HQPlayer", (platform, profile) => {
  it.each(["GetInfo", "State", "Status", "VolumeRange"])(
    "%s: same element, and no attribute the real one lacks",
    async (command) => {
      const real = recorded(platform, command);
      const fake = await fakeReply(stopped(profile), command);
      expect(fake.name).toBe(real.name);
      expect(Object.keys(fake.attrs).filter((a) => !(a in real.attrs))).toEqual([]);
    },
  );

  it.each(["GetInfo", "State", "Status", "VolumeRange"])("%s: leaves out only attributes hqpweb never reads", async (command) => {
    const real = recorded(platform, command);
    const fake = await fakeReply(stopped(profile), command);
    const missing = Object.keys(real.attrs).filter((a) => !(a in fake.attrs));
    expect(missing.filter((a) => !NOT_READ_BY_HQPWEB.includes(a))).toEqual([]);
  });

  it("writes the volume in the same format (long on Linux, short on macOS, measured)", async () => {
    const shape = (v: string | undefined) => (v && /\.\d{17}$/.test(v) ? "long" : "short");
    const fake = await fakeReply(stopped(profile), "State");
    expect(shape(fake.attrs.volume)).toBe(shape(recorded(platform, "State").attrs.volume));
  });

  it("reports the same volume range (the guard clamps to its maximum)", async () => {
    const real = recorded(platform, "VolumeRange").attrs;
    const fake = (await fakeReply(stopped(profile), "VolumeRange")).attrs;
    expect([Number(fake.min), Number(fake.max)]).toEqual([Number(real.min), Number(real.max)]);
  });

  it("reports the same product and platform", async () => {
    // The engine may differ: the macOS profile's lists were captured on 5.32.5.
    const real = recorded(platform, "GetInfo").attrs;
    const fake = (await fakeReply(stopped(profile), "GetInfo")).attrs;
    expect([fake.product, fake.platform, fake.version]).toEqual([real.product, real.platform, real.version]);
  });
});

it("hqpweb's Status parser reads none of the attributes the fake leaves out", () => {
  // They're all Status attributes; "min" elsewhere in parse.ts is VolumeRange's minimum.
  const source = readFileSync(new URL("../../protocol/src/parse.ts", import.meta.url), "utf8");
  const parseStatus = source.slice(
    source.indexOf("export function parseStatus"),
    source.indexOf("\n}\n", source.indexOf("export function parseStatus")),
  );
  expect(parseStatus.length).toBeGreaterThan(100); // found it
  expect(NOT_READ_BY_HQPWEB.filter((a) => parseStatus.includes(`"${a}"`))).toEqual([]);
});

describe("behaviours the safety rules rely on, with their evidence", () => {
  const playing = (profile: ProfileId) => {
    const f = new FakeHqp(loadProfile(profile), { timeScale: 0 });
    f.playback = 2;
    return f;
  };
  const rateIndex = (f: FakeHqp, hz: number) => f.lists.rates.indexOf(hz);
  const setRate = (f: FakeHqp, hz: number) => f.handle(`<SetRate value="${rateIndex(f, hz)}"/>`);
  const state = async (f: FakeHqp) => Number((await fakeReply(f, "Status")).attrs.state);

  it("an incompatible combination stops playback: AHM7EC8B at DSD512 (design §2.3, measured on macOS 5.32.5)", async () => {
    const f = playing("desktop5-mac-sdm");
    await setRate(f, 22_579_200);
    expect(await state(f)).toBe(0);
  });

  it("Play is ignored while it can't play (§2.3, measured)", async () => {
    const f = playing("desktop5-mac-sdm");
    await setRate(f, 22_579_200);
    await f.handle("<Play/>");
    expect(await state(f)).toBe(0);
  });

  it("with Roon as the source, fixing the rate resumes playback (§2.3, measured)", async () => {
    const f = playing("desktop5-mac-sdm");
    await setRate(f, 22_579_200);
    await setRate(f, 0);
    expect(await state(f)).toBe(2);
  });

  it("from HQPlayer's own playlist, fixing the rate leaves it stopped (§2.3, measured on Linux 5.35.10)", async () => {
    const f = playing("desktop5-linux-pcm");
    f.feeder = "playlist";
    f.playlist = ["/music/Example Artist/Example Album/01 - Example.flac"];
    await setRate(f, 176_400);
    await f.handle(`<SetFilter value="${f.rem.filterNx}" value1x="${f.lists.filters.find((x) => x.name === "sinc-M")!.index}"/>`);
    await setRate(f, 192_000); // sinc-M can't do 4.35×
    await setRate(f, 176_400);
    expect(await state(f)).toBe(0);
  });

  it("an overloaded machine keeps playing (state 2) while falling behind real time (§2.3: ASDM7EC at 0.53×)", async () => {
    const f = new FakeHqp(loadProfile("desktop5-mac-sdm"), { timeScale: 0, speed: () => 0.5 });
    f.playback = 2;
    const p0 = Number((await fakeReply(f, "Status")).attrs.position);
    await new Promise((r) => setTimeout(r, 400));
    const s = (await fakeReply(f, "Status")).attrs;
    expect(Number(s.state)).toBe(2);
    expect(Number(s.position) - p0).toBeLessThan(0.3); // 0.4 s of wall clock at half speed
  });

  it.each(STOP_RULES.map((r) => [r.example.shaperName, r.example.filterName, r.example.rateHz, r] as const))(
    "the fake's own stop rule (%s, %s at %i Hz) is one the app predicts",
    (_s, _f, _hz, rule) => {
      const c = rule.example;
      expect(rule.stops(c)).toBe(true);
      const predicted = predictedStop({
        mode: c.modeName,
        filter: c.filterName,
        shaper: c.shaperName,
        sourceRate: c.sourceRate,
        outputRate: c.rateHz,
      });
      expect(predicted?.level).toBe("hard");
    },
  );

  it("decides stops from its own table, not the app's predictions", () => {
    // The app predicts a whole-number-ratio stop for FIR at 44.1k → 96k (§4.6); the
    // fake has no measurement of it, so it plays. They're independent.
    const c = { modeName: "PCM", rateHz: 96_000, shaperName: "TPDF", filterName: "FIR", sourceRate: 44_100 };
    const predicted = predictedStop({
      mode: c.modeName,
      filter: c.filterName,
      shaper: c.shaperName,
      sourceRate: c.sourceRate,
      outputRate: c.rateHz,
    });
    expect([predicted?.level, defaultIncompatible(c)]).toEqual(["hard", false]);
  });

  it("a volume set over the control API reads back as set, as a float (§2.1)", async () => {
    const f = playing("desktop5-linux-pcm");
    await f.handle('<Volume value="-40.5"/>');
    expect(Number((await fakeReply(f, "State")).attrs.volume)).toBe(-40.5);
  });
});
