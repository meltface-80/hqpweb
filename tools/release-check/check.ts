// Live release check (docs/release-checklist.md): what no fake can show. Changes go
// through the real hqpweb server, started here against a real HQPlayer; every result
// is checked by reading HQPlayer directly (CLAUDE.md rule 4: never trust "OK").
//
//   HQPWEB_CHECK_HOST=… HQPWEB_CHECK_FILE=… npm run release-check            (dry run: reads only)
//   HQPWEB_CHECK_HOST=… HQPWEB_CHECK_FILE=… npm run release-check -- --write (needs the owner's OK)
//
// HQPWEB_CHECK_FILE is a quiet 44.1 kHz test file, as a path on HQPlayer's machine.
// Follows CLAUDE.md rule 3: snapshot, apply, verify playback, restore, compare. The
// volume is only ever lowered, and the restore never touches it.
import { cmd, element, HqpClient, type Status } from "@app/protocol";
import { buildApp } from "../../apps/server/src/app.ts";
import { compare, named, type Lists, type Named } from "./settings.ts";

const host = process.env.HQPWEB_CHECK_HOST;
const file = process.env.HQPWEB_CHECK_FILE;
const port = Number(process.env.HQPWEB_CHECK_PORT ?? 4321);
const write = process.argv.includes("--write");
if (!host || !file) {
  console.error("Set HQPWEB_CHECK_HOST (HQPlayer's address) and HQPWEB_CHECK_FILE (test file path on that machine).");
  process.exit(2);
}

// What the check uses. Both filters are in every v5 PCM list seen so far (inferred for others).
const LIGHT = "poly-sinc-short-mp"; // a quick change that any machine plays
const POW2 = "sinc-M"; // needs a power-of-two ratio (manual §4.6): fine at 4×, not at 4.35×
const FITS = 176_400; // 44.1k × 4
const NOT = 192_000; // 44.1k × 4.35

const hq = new HqpClient(host, { port });
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${s}`);
const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail = "") => {
  results.push({ step, ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? `: ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: (s: Status) => boolean, ms: number): Promise<Status> {
  const end = Date.now() + ms;
  let s = await hq.status();
  while (!what(s) && Date.now() < end) {
    await sleep(500);
    s = await hq.status();
  }
  return s;
}
const lists = async (): Promise<Lists> => ({
  modes: await hq.modes(),
  filters: await hq.filters(),
  shapers: await hq.shapers(),
  rates: await hq.rates(),
});
const now = async () => named(await hq.state(), await lists());

// ---- preflight: reads only -------------------------------------------------------
const info = await hq.info();
const status = await hq.status();
const l = await lists();
const before = await now();
// Roon's own entries (song "Roon", an http stream; seen 2026-10-04) can't be re-added,
// and Roon doesn't need them back: leave them out.
const playlist = async () =>
  (await hq.request(cmd.playlistGet())).children
    .filter((c) => c.name === "PlaylistItem" && c.attrs.uri && c.attrs.song !== "Roon")
    .map((c) => c.attrs.uri!);
const queued = await playlist();
// Anything queued, Roon's entries included, has to go first: Play otherwise starts the wrong item (seen 2026-10-04).
const anyQueued = (await hq.request(cmd.playlistGet())).children.some((c) => c.name === "PlaylistItem");
// 1 dB steps: repeated runs shouldn't walk the volume down to the floor.
const v1 = before.volume - 1;
const v2 = before.volume - 2;
const refuse = [
  status.state !== 0 && "HQPlayer is playing: someone may be listening",
  before.volume > -20 && `volume is ${before.volume} dB; start at −20 dB or lower`,
  before.mode !== "PCM" && `mode is ${before.mode}; the check needs PCM`,
  ...[LIGHT, POW2].map((f) => !l.filters.some((x) => x.name === f) && `no filter ${f} on this instance`),
  ...[FITS, NOT].map((r) => !l.rates.some((x) => x.rate === r) && `no ${r / 1000} kHz output rate on this instance`),
].filter(Boolean);

console.log(`${info.product} ${info.engine} on ${info.platform} ("${info.name}")`);
console.log(`Start: ${JSON.stringify(before)}`);
console.log(`Plan (writes):
  1. lower the volume to ${v1} dB
  2. ${anyQueued ? `clear HQPlayer's playlist (${queued.length} item(s) to put back at the end); ` : ""}play the test file from HQPlayer's playlist; expect 44.1 kHz playing
  3. 1x filter → ${LIGHT}; expect ✓ and playback OK; 4. undo it
  5. output rate ${FITS / 1000} kHz with ${POW2} (4×); expect playback OK
  6. rate ${NOT / 1000} kHz (4.35×) with the volume at ${v2} dB; expect HQPlayer to stop,
     hqpweb to roll the rate back and explain it, playback to recover, and the volume to stay at ${v2} dB
  7. stop; then restore every setting except the volume, put the playlist back, and compare`);
if (refuse.length) {
  console.error(`\nNot starting:\n  ${refuse.join("\n  ")}`);
  process.exit(1);
}
if (!write) {
  console.log("\nDry run: nothing written. Add --write, with the owner's OK, to run it.");
  hq.close();
  process.exit(0);
}

// ---- the check: changes through hqpweb, verified against HQPlayer ----------------
const app = buildApp({ instances: [{ id: "live", name: "Release check", host, port }] });
const base = await app.listen(0, "127.0.0.1");
async function api(path: string, body?: object): Promise<any> {
  const r = await fetch(`${base}/api/instances/live/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${text}`);
  return JSON.parse(text);
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

try {
  await api("change", { volume: v1 });
  const vs = await hq.state();
  record("1. volume lowered", near(vs.volume, v1), `${vs.volume} dB`);

  // No playlist route in hqpweb: queue the file directly (measured: start="1" makes the playlist the transport).
  if (anyQueued) await hq.send(element("PlaylistClear"));
  await hq.send(element("PlaylistAdd", { uri: file, start: 1 }));
  const play = await api("transport", { action: "play" });
  let s = await until((x) => x.state === 2 && x.position > 1, 15_000);
  record(
    "2. test file plays",
    s.state === 2 && s.source?.sampleRate === 44_100,
    `state ${s.state}, source ${s.source?.sampleRate ?? "none"} Hz${play.notStarted ? `, hqpweb: ${JSON.stringify(play.notStarted)}` : ""}`,
  );

  let r = await api("change", { filter1x: LIGHT });
  s = await until((x) => x.activeFilter === LIGHT, 10_000);
  record(
    "3. quick change takes effect",
    r.results[0]?.applied && r.playback.kind === "playing" && s.activeFilter === LIGHT,
    `applied ${r.results[0]?.applied}, playback ${r.playback.kind}, HQPlayer uses ${s.activeFilter}`,
  );

  r = await api("undo", {}); // a POST with no fields
  s = await until((x) => x.activeFilter === before.filter1x, 10_000);
  record("4. undo restores it", s.activeFilter === before.filter1x, `HQPlayer uses ${s.activeFilter}`);

  r = await api("change", { rate: FITS, filter1x: POW2 });
  s = await until((x) => x.state === 2 && x.activeRate === FITS && x.activeFilter === POW2, 15_000);
  record(
    "5. fixed rate with a compatible ratio plays",
    r.playback.kind === "playing" && s.state === 2 && s.activeRate === FITS,
    `playback ${r.playback.kind}, HQPlayer at ${s.activeRate} Hz with ${s.activeFilter}`,
  );

  // Trace HQPlayer through the rollback, so a failure explains itself.
  const trace: string[] = [];
  let tracing = true;
  const t6 = Date.now();
  const tracer = (async () => {
    let last = "";
    while (tracing) {
      const x = await hq.status();
      const line = `state ${x.state}, ${x.activeRate} Hz, pos ${Math.floor(x.position)}`;
      if (line !== last) trace.push(`+${((Date.now() - t6) / 1000).toFixed(1)}s ${line}`);
      last = line;
      await sleep(250);
    }
  })();
  r = await api("change", { rate: NOT, volume: v2 });
  const after6: Named = await now();
  // Playing really means the position moves: HQPlayer can report state 2 and stay at 0 (measured).
  const moving = (x: Status) => x.state === 2 && x.position > 2;
  s = await until(moving, 10_000);
  // If it didn't come back by itself, press what hqpweb's Restart playback button presses.
  let how = moving(s) ? "by itself" : "";
  if (r.rolledBack && !how) {
    await api("transport", { action: "stop" });
    await sleep(500);
    await api("transport", { action: "play" });
    s = await until(moving, 20_000);
    how = moving(s)
      ? "after Restart playback (Stop, then Play)"
      : `not even after Restart playback: state ${s.state}, position ${s.position}`;
  }
  tracing = false;
  await tracer;
  log(`HQPlayer during step 6 (from the change request):\n          ${trace.join("\n          ")}`);
  if (!r.rolledBack) {
    record(
      "6. incompatible ratio is rolled back",
      false,
      `not rolled back: playback ${r.playback.kind}, HQPlayer ${s.state === 2 ? "kept playing" : "stopped"} at ${s.activeRate} Hz. ` +
        "If it played, the ratio rule doesn't hold on this engine: record it in design §2.",
    );
  } else {
    record("6a. incompatible ratio is rolled back", after6.rate === FITS, `rate back to ${after6.rate} Hz`);
    record("6b. and explained", !!r.incompatible, r.incompatible?.text ?? "no explanation");
    record(
      "6c. playback recovers, by itself or with Restart playback",
      moving(s),
      `${how} (hqpweb judged: ${r.rolledBack.playback.kind})`,
    );
    record("6d. the rollback keeps the volume low (#20)", near(after6.volume, v2), `${after6.volume} dB`);
  }

  await api("transport", { action: "stop" });
  s = await until((x) => x.state === 0, 10_000);
  record("7. stop", s.state === 0, `state ${s.state}`);
} catch (e) {
  record("check ran to the end", false, (e as Error).message);
} finally {
  // Restore: stopped, playlist empty, every setting back by name except the volume.
  try {
    if ((await hq.status()).state !== 0) await hq.send(cmd.stop());
    await hq.send(element("PlaylistClear"));
    for (const uri of queued) await hq.send(element("PlaylistAdd", { uri }));
    const cur = await now();
    const back = Object.fromEntries(
      (["rate", "filter1x", "filterNx", "shaper", "invert", "filter20k", "adaptive"] as const)
        .filter((k) => cur[k] !== before[k])
        .map((k) => [k, before[k]]),
    );
    if (Object.keys(back).length) await api("change", back);
  } catch (e) {
    record("restore", false, (e as Error).message);
  }
  const list = await playlist().catch(() => ["(couldn't read it)"]);
  record("playlist put back", JSON.stringify(list) === JSON.stringify(queued), `${list.length} item(s), was ${queued.length}`);
  log("NOTE  HQPlayer's own Play button now uses its playlist (the test file selected it). Roon still plays to it (measured).");
  const end = await now();
  const c = compare(before, end);
  record("restored to the snapshot", c.differs.length === 0, c.differs.join("; ") || "all settings match");
  if (c.volumeNote) log(`NOTE  ${c.volumeNote}`);
  await app.close();
  hq.close();
}

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
