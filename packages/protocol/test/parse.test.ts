// Replies recorded from real instances on 2026-10-02 (read-only), sanitised:
// instance names replaced, Status metadata dropped.
import { describe, expect, it } from "vitest";
import {
  cmd,
  outcome,
  parseConfigurationList,
  parseDocument,
  parseFilters,
  parseInfo,
  parseModes,
  parseState,
  parseStatus,
  parseVolumeRange,
} from "../src/index.ts";

const H = '<?xml version="1.0" encoding="utf-8"?>';
const R = {
  info: H + '<GetInfo engine="5.32.5" name="fake-mac" platform="Mac" product="Signalyst HQPlayer Desktop" version="5"/>',
  stateMac:
    H +
    '<State active_mode="1" active_rate="45158400" adaptive="0" convolution="0" filter="51" filter1x="49" filterNx="51" filter_20k="0" invert="0" matrix_profile="" mode="2" random="0" rate="0" repeat="0" shaper="35" state="2" volume="-22"/>',
  stateLinux:
    H +
    '<State active_mode="0" active_rate="384000" adaptive="0" convolution="0" filter="37" filter1x="37" filterNx="40" filter_20k="0" invert="0" matrix_profile="" mode="1" random="0" rate="0" repeat="0" shaper="3" state="0" volume="-28.00000000000000000"/>',
  statusLinux:
    H +
    '<Status active_bits="32" active_channels="2" active_filter="poly-sinc-gauss-long" active_mode="PCM" active_rate="384000" active_shaper="NS5" apod="0" begin_min="0" begin_sec="0" clips="0" correction="0" display_position="0.00000000000000000" filter_20k="0" input_fill="0.00000000000000000" length="0.00000000000000000" min="0" output_delay="0" output_fill="0.00000000000000000" position="0.00000000000000000" process_speed="0.00000000000000000" queued="0" random="0" remain_min="0" remain_sec="0" repeat="0" sec="0" state="0" total_min="0" total_sec="0" track="0" track_serial="27" tracks_total="0" transport_serial="39" volume="-28.00000000000000000"/>',
  modes:
    H +
    '<GetModes><ModesItem index="0" name="[source]" value="-1"/><ModesItem index="1" name="PCM" value="0"/><ModesItem index="2" name="SDM (DSD)" value="1"/></GetModes>',
  filters:
    H +
    '<GetFilters><FiltersItem arg="1" index="0" name="IIR" value="64"/><FiltersItem arg="2" index="6" name="poly-sinc-lp" value="0"/></GetFilters>',
  vrMac: H + '<VolumeRange adaptive="0" enabled="1" max="-3" min="-60"/>',
  vrLinux: H + '<VolumeRange adaptive="0" enabled="1" max="0.00000000000000000" min="-60.00000000000000000"/>',
  set20k: H + "<Set20kFilter/>",
  setConv: H + '<SetConvolution result="OK" value="0"/>',
  unknown: H + '<NoSuchCommandXyz result="Error">Unknown command</NoSuchCommandXyz>',
  cfgLoad: H + '<ConfigurationLoad result="Error">missing data or not authorized</ConfigurationLoad>',
  cfgList:
    H +
    '<ConfigurationList active="" result="OK"><ConfigurationItem name="Example configuration 1"/><ConfigurationItem name="Example configuration 2"/></ConfigurationList>',
  cfgListErr: H + '<ConfigurationList result="Error">path doesn\'t exist</ConfigurationList>',
};
const doc = (k: keyof typeof R) => parseDocument(R[k]);

describe("outcome", () => {
  it("treats a missing result attribute as its own case, not OK", () => {
    expect(outcome(doc("set20k"))).toEqual({ kind: "none" });
  });
  it("reports OK for a no-op convolution change (measured: OK, nothing changed)", () => {
    expect(outcome(doc("setConv"))).toEqual({ kind: "ok" });
  });
  it("carries the error text", () => {
    expect(outcome(doc("unknown"))).toEqual({ kind: "error", message: "Unknown command" });
    expect(outcome(doc("cfgLoad"))).toEqual({ kind: "error", message: "missing data or not authorized" });
  });
});

describe("volume is a float in dB", () => {
  it("parses the macOS short form", () => {
    expect(parseState(doc("stateMac")).volume).toBe(-22);
  });
  it("parses the Linux long form", () => {
    expect(parseState(doc("stateLinux")).volume).toBe(-28);
    expect(parseStatus(doc("statusLinux")).volume).toBe(-28);
  });
  it("reads both VolumeRange maxima (-3 on Mac, 0 on Linux)", () => {
    expect(parseVolumeRange(doc("vrMac"))).toEqual({ min: -60, max: -3, enabled: true, adaptive: false });
    expect(parseVolumeRange(doc("vrLinux")).max).toBe(0);
  });
  it("never yields 0 dB from a fractional value", () => {
    const el = parseDocument(
      H +
        '<State active_mode="1" active_rate="0" filter="0" filter1x="0" filterNx="0" mode="0" rate="0" shaper="0" state="0" volume="-0.5"/>',
    );
    expect(parseState(el).volume).toBe(-0.5);
  });
  it("throws instead of guessing on a non-numeric volume", () => {
    const el = parseDocument(
      H +
        '<State active_mode="1" active_rate="0" filter="0" filter1x="0" filterNx="0" mode="0" rate="0" shaper="0" state="0" volume=""/>',
    );
    expect(() => parseState(el)).toThrow(/volume/);
  });
  it("refuses to build a non-finite Volume command", () => {
    expect(() => cmd.volume(Number.NaN)).toThrow();
    expect(cmd.volume(-22.5)).toBe('<Volume value="-22.5"/>');
  });
});

describe("State", () => {
  it("distinguishes the mode index from the active mode value", () => {
    const s = parseState(doc("stateMac"));
    expect(s.mode).toBe(2); // index of "SDM (DSD)" in GetModes
    expect(s.activeMode).toBe(1); // its value
    expect(s.filterInUse).toBe(51);
    expect(s.rate).toBe(0); // auto
  });
});

describe("lists and info", () => {
  it("parses GetInfo", () => {
    expect(parseInfo(doc("info"))).toMatchObject({ engine: "5.32.5", version: "5", platform: "Mac" });
  });
  it("parses modes and filters", () => {
    expect(parseModes(doc("modes")).map((m) => m.name)).toEqual(["[source]", "PCM", "SDM (DSD)"]);
    expect(parseFilters(doc("filters"))[1]).toEqual({ index: 6, name: "poly-sinc-lp", value: 0, arg: 2 });
  });
  it("parses configuration lists, including the no-configs error", () => {
    expect(parseConfigurationList(doc("cfgList"))).toEqual({
      names: ["Example configuration 1", "Example configuration 2"],
      active: "",
    });
    expect(parseConfigurationList(doc("cfgListErr"))).toEqual({ error: "path doesn't exist" });
  });
});

describe("request builders", () => {
  it("match the shapes sent live", () => {
    expect(cmd.setFilter(53, 49)).toBe('<SetFilter value="53" value1x="49"/>');
    expect(cmd.set20kFilter(true)).toBe('<Set20kFilter value="1"/>');
    expect(cmd.status()).toBe('<Status subscribe="0"/>');
  });
  it("reject non-index arguments", () => {
    expect(() => cmd.setRate(-1)).toThrow();
    expect(() => cmd.setMode(1.5)).toThrow();
  });
});

describe("matrix profiles", () => {
  it("parses the SDK's MatrixProfile items, and the measured empty list", async () => {
    const { parseMatrixProfiles } = await import("../src/index.ts");
    const H2 = '<?xml version="1.0" encoding="utf-8"?>';
    expect(parseMatrixProfiles(parseDocument(H2 + '<MatrixListProfiles result="OK"/>'))).toEqual([]);
    expect(
      parseMatrixProfiles(
        parseDocument(
          H2 +
            '<MatrixListProfiles result="OK"><MatrixProfile name="Headphones"/><MatrixProfile name="Room EQ"/></MatrixListProfiles>',
        ),
      ),
    ).toEqual(["Headphones", "Room EQ"]);
    expect(cmd.matrixSetProfile("Room EQ")).toBe('<MatrixSetProfile value="Room EQ"/>');
  });
});

describe("attribute escaping", () => {
  it("keeps a request on one line whatever the value", async () => {
    const { escapeAttr } = await import("../src/xml.ts");
    expect(escapeAttr('a"b<c>&\nd\re\tf')).toBe("a&quot;b&lt;c&gt;&amp;&#10;d&#13;e&#9;f");
  });
});

describe("process_speed", () => {
  it("is a number when HQPlayer reports it, null when it doesn't (older versions)", async () => {
    const { parseDocument } = await import("../src/xml.ts");
    const { parseStatus } = await import("../src/parse.ts");
    const withIt = parseDocument(
      '<Status state="2" active_rate="96000" position="1" process_speed="31.53564763005124405" volume="-20"/>',
    );
    const without = parseDocument('<Status state="2" active_rate="96000" position="1" volume="-20"/>');
    expect(parseStatus(withIt).processSpeed).toBeCloseTo(31.54, 1);
    expect(parseStatus(without).processSpeed).toBeNull();
  });
});

describe("queuedRate (PlaylistGet)", () => {
  it("takes the current entry's rate, else the first; null when empty (shape measured on 6.2.3)", async () => {
    const { queuedRate } = await import("../src/parse.ts");
    const parseXml = parseDocument;
    const el = parseXml(
      '<PlaylistGet album="0"><PlaylistItem index="1" rate="44100" length="600"/><PlaylistItem index="2" rate="96000" length="300"/></PlaylistGet>',
    );
    expect(queuedRate(el, 0)).toBe(44_100);
    expect(queuedRate(el, 2)).toBe(96_000);
    expect(queuedRate(parseXml('<PlaylistGet album="0"/>'), 0)).toBeNull();
  });
});
