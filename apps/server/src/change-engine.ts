// The change engine (design §4.2, generalised): resolve names → apply in order → read
// State back → if the change could disturb playback and something was playing, watch it →
// if playback stopped or can't keep up, record the combination as failed and roll back to
// the snapshot. It also keeps the undo. Moved from instance.ts, unchanged; Instance runs
// its calls one at a time.
import {
  cmd,
  filterSlot,
  predictedStop,
  queuedRate,
  shaperBeforeRate,
  type HqpClient,
  type Hint,
  type Outcome,
  type State,
} from "@app/protocol";
import { HttpError } from "./errors.ts";
import type { ApplyResult, Capabilities, Change, Field, FieldResult, PlaybackCheck } from "./instance.ts";
import type { Combo, LearnedStore } from "./learned.ts";
import { MODE_BOUND } from "./preset-preview.ts";
import { settingsOf } from "./settings.ts";
import { decideVolume, VOLUME_EPS } from "./volume.ts";
import { watchPlayback, type Verdict, type WatchTiming } from "./watch.ts";

/** Fields whose change can stop playback or overload the machine. */
export const RISKY: readonly Field[] = ["mode", "rate", "filterNx", "filter1x", "shaper", "convolution", "matrixProfile"];

export interface EngineDeps {
  client: HqpClient;
  /** The instance's lists for the current mode (fresh = re-read). */
  capabilities: (fresh?: boolean) => Promise<Capabilities>;
  learned: LearnedStore;
  instanceId: string;
  timing: { quick: WatchTiming; major: WatchTiming };
  /** hqpweb itself just set the volume (so the status poller doesn't call it a jump). */
  onVolumeWrite: (v: number) => void;
}

export class ChangeEngine {
  private readonly client: HqpClient;
  private readonly capabilities: EngineDeps["capabilities"];
  private readonly learned: LearnedStore;
  private readonly instanceId: string;
  private readonly timing: EngineDeps["timing"];
  private readonly onVolumeWrite: EngineDeps["onVolumeWrite"];
  /** The previous values of the fields the last change touched, by name. */
  private undoChange: Change | null = null;
  private undoMode: number | null = null;
  /** The volume the last change set, so undo can tell whether anyone moved it since. */
  private lastSetVolume: number | null = null;

  constructor(d: EngineDeps) {
    this.client = d.client;
    this.capabilities = d.capabilities;
    this.learned = d.learned;
    this.instanceId = d.instanceId;
    this.timing = d.timing;
    this.onVolumeWrite = d.onVolumeWrite;
  }

  async undo(): Promise<ApplyResult> {
    if (!this.undoChange) throw new HttpError(409, "nothing to undo");
    const state = await this.client.state();
    if (state.mode !== this.undoMode) throw new HttpError(409, "mode changed since the last change; undo is not safe");
    return this.apply(this.undoChange, true);
  }

  async apply(change: Change, isUndo: boolean, lenient = false): Promise<ApplyResult> {
    const fields = (Object.keys(change) as Field[]).filter((k) => change[k] !== undefined);
    if (fields.length === 0) throw new HttpError(400, "empty change");

    const playingBefore = (await this.client.status()).state === 2;
    const applied = await this.applyFields(change, isUndo, lenient);
    const skipped = applied.skipped.length ? { skipped: applied.skipped } : {};
    const risky = applied.results.some((r) => RISKY.includes(r.field));
    const timing = applied.major ? this.timing.major : this.timing.quick;

    let playback: PlaybackCheck;
    if (!risky) playback = { kind: "not-checked", detail: "this change can't stop playback" };
    else if (!playingBefore) playback = { kind: "not-checked", detail: "nothing was playing, so playback couldn't be checked" };
    else playback = await this.watch(timing);

    if (playback.kind === "stopped" || playback.kind === "struggling") {
      // A rule-explained stop is HQPlayer's design, not this machine's limit: don't learn it.
      const incompatible = await this.explain().catch(() => undefined);
      // Never let bookkeeping (e.g. an unwritable config volume) block the rollback.
      if (!incompatible)
        await this.recordFailure(playback.detail).catch((e: Error) =>
          console.error(`could not record failed combination: ${e.message}`),
        );
      // Roll back. Volume is only ever lowered: nobody asked for a raise (volume.ts).
      // Lenient: restore what can be restored even if a name has vanished (e.g.
      // HQPlayer restarted on its saved settings). Undo is cleared whatever
      // happens, so it can never point at the wrong change.
      this.lastSetVolume = applied.volumeSet;
      this.undoChange = null;
      let back: { results: FieldResult[]; state: State };
      let recovered: PlaybackCheck;
      try {
        back = await this.applyFields(applied.prev, true, true, true);
        recovered = await this.watch(this.timing.major);
      } catch (e) {
        back = { results: [], state: await this.client.state() };
        recovered = { kind: "inconclusive", detail: `couldn't roll back: ${(e as Error).message}` };
      } finally {
        this.lastSetVolume = null;
      }
      return {
        class: applied.major ? "major" : "quick",
        results: applied.results,
        playback,
        rolledBack: { results: back.results, playback: recovered },
        state: back.state,
        undoAvailable: false,
        ...(incompatible ? { incompatible } : {}),
        ...skipped,
      };
    }

    if (applied.results.length === 0) {
      // Nothing could be applied: leave undo as it was.
    } else if (!isUndo) {
      this.undoChange = applied.prev;
      this.undoMode = applied.state.mode;
      this.lastSetVolume = applied.volumeSet;
    } else {
      this.undoChange = null;
      this.lastSetVolume = null;
    }
    return {
      class: applied.major ? "major" : "quick",
      results: applied.results,
      playback,
      rolledBack: null,
      state: applied.state,
      undoAvailable: this.undoChange !== null,
      ...skipped,
    };
  }

  /** Apply without watching. Returns read-back results and how to undo, by name. */
  private async applyFields(change: Change, isUndo: boolean, lenient = false, rollback = false) {
    const requestedFields = (Object.keys(change) as Field[]).filter((k) => change[k] !== undefined);
    const problems: { field: Field; reason: string }[] = [];
    const caps0 = await this.capabilities(true);
    const before = await this.client.state();
    if (before.mode !== caps0.mode.index) throw new HttpError(409, "mode changed; try again");
    const was = settingsOf(caps0, before);
    const replies = new Map<Field, Outcome>();

    // ---- 1. mode first: every list changes with it ------------------------
    let caps = caps0;
    let modeSwitched = false;
    if (change.mode !== undefined && change.mode !== was.mode) {
      const m = caps0.modes.find((x) => x.name === change.mode);
      if (!m) {
        if (!lenient) throw new HttpError(422, `mode "${change.mode}" is not available on this instance`);
        problems.push({ field: "mode", reason: `mode "${change.mode}" is not available on this instance` });
        // Rate, filters and modulator/dither were chosen for that mode: don't apply them to this one.
        for (const f of MODE_BOUND)
          if (change[f] !== undefined) problems.push({ field: f, reason: `belongs to mode "${change.mode}"` });
      } else {
        replies.set("mode", await this.client.send(cmd.setMode(m.index)));
        caps = await this.capabilities(true);
        modeSwitched = caps.mode.name !== was.mode;
      }
    }
    const undoModeSwitch = async () => {
      if (!modeSwitched) return;
      const m = caps.modes.find((x) => x.name === was.mode);
      if (m) await this.client.send(cmd.setMode(m.index));
    };

    // ---- 2. resolve everything else against the lists of the mode we're in --
    const alreadySkipped = (f: Field) => problems.some((p) => p.field === f);
    const resolve = <T extends { index: number; name: string }>(list: T[], field: Field, name?: string) => {
      if (name === undefined || alreadySkipped(field)) return undefined;
      const hit = list.find((x) => x.name === name);
      if (!hit) problems.push({ field, reason: `"${name}" is not available in ${caps.mode.name} on engine ${caps.engine}` });
      return hit?.index;
    };
    let rateIdx: number | undefined;
    if (change.rate !== undefined && !alreadySkipped("rate")) {
      const opt = caps.rates.find((r) => r.rate === change.rate);
      const p = (reason: string) => problems.push({ field: "rate", reason });
      if (!caps.rateSettable) p(`rate can't be set in ${caps.mode.name} mode`);
      else if (!opt) p(`${change.rate} Hz is not offered in ${caps.mode.name}`);
      else if (!opt.allowed) p(`${change.rate} Hz: ${opt.note}`);
      else rateIdx = opt.index;
    }
    const nx = resolve(caps.filters, "filterNx", change.filterNx);
    const x1 = resolve(caps.filters, "filter1x", change.filter1x);
    const shaper = resolve(caps.shapers, "shaper", change.shaper);
    // HQPlayer accepts unknown profile names with OK (reported), so only send listed ones.
    // Undo/rollback may restore "" (no profile active); read-back verifies it took.
    const restoringNone = isUndo && change.matrixProfile === "";
    if (change.matrixProfile !== undefined && !restoringNone && !caps.matrixProfiles.includes(change.matrixProfile))
      problems.push({
        field: "matrixProfile",
        reason: caps.matrixProfiles.length
          ? `"${change.matrixProfile}" is not one of this instance's matrix profiles`
          : "no matrix profiles are set up in HQPlayer on this instance",
      });

    // ---- 3. volume guards (design §7; rules in volume.ts) --------------------
    let volume: number | undefined;
    let volumeNote: string | undefined;
    if (change.volume !== undefined) {
      const untouched = this.lastSetVolume !== null && Math.abs(before.volume - this.lastSetVolume) <= VOLUME_EPS;
      const kind = rollback ? "rollback" : isUndo ? "undo" : "change";
      const d = decideVolume({ requested: change.volume, current: before.volume, range: caps.volumeRange, kind, untouched });
      volume = d.set;
      volumeNote = d.note;
      if (d.problem) problems.push({ field: "volume", reason: d.problem });
    }

    if (problems.length && !lenient) {
      await undoModeSwitch();
      throw new HttpError(422, problems.map((p) => (p.field === "volume" ? p.reason : `${p.field}: ${p.reason}`)).join("; "));
    }
    const skippedFields = new Set(problems.map((p) => p.field));
    const fields = requestedFields.filter((f) => !skippedFields.has(f));

    // ---- 4. apply in the design's order (§4.3) --------------------------------
    // Except: when rate and modulator change together, never pass through a pair that
    // can't play (shaperBeforeRate). The old rate may be auto; then what's active counts.
    const fromRate = rateIdx !== undefined && shaper !== undefined ? was.rate || (await this.client.status()).activeRate : 0;
    const modulatorFirst =
      rateIdx !== undefined &&
      shaper !== undefined &&
      shaperBeforeRate({ fromRate, toRate: change.rate ?? 0, fromShaper: was.shaper, toShaper: change.shaper ?? "" });
    if (modulatorFirst) replies.set("shaper", await this.client.send(cmd.setShaping(shaper!)));
    if (rateIdx !== undefined) replies.set("rate", await this.client.send(cmd.setRate(rateIdx)));
    if (nx !== undefined || x1 !== undefined) {
      // SetFilter always carries both indices; keep the one not being changed.
      const cur = modeSwitched ? await this.client.state() : before;
      const r = await this.client.send(cmd.setFilter(nx ?? cur.filterNx, x1 ?? cur.filter1x));
      if (nx !== undefined) replies.set("filterNx", r);
      if (x1 !== undefined) replies.set("filter1x", r);
    }
    if (shaper !== undefined && !modulatorFirst) replies.set("shaper", await this.client.send(cmd.setShaping(shaper)));
    if (change.invert !== undefined) replies.set("invert", await this.client.send(cmd.setInvert(change.invert)));
    if (change.filter20k !== undefined) replies.set("filter20k", await this.client.send(cmd.set20kFilter(change.filter20k)));
    if (change.adaptive !== undefined) replies.set("adaptive", await this.client.send(cmd.setAdaptiveVolume(change.adaptive)));
    if (change.convolution !== undefined && fields.includes("convolution"))
      replies.set("convolution", await this.client.send(cmd.setConvolution(change.convolution)));
    if (change.matrixProfile !== undefined && fields.includes("matrixProfile"))
      replies.set("matrixProfile", await this.client.send(cmd.matrixSetProfile(change.matrixProfile)));
    if (volume !== undefined) {
      this.onVolumeWrite(volume);
      replies.set("volume", await this.client.send(cmd.volume(volume)));
    }

    // ---- 5. read back: State is the verdict, not the reply (rule 4) ----------
    const after = await this.client.state();
    const now = settingsOf(caps, after);
    const results: FieldResult[] = fields.map((field) => {
      const reply = replies.get(field) ?? { kind: "none" as const };
      const requested = change[field]!;
      if (field === "volume") {
        return {
          field,
          requested,
          actual: now.volume,
          applied: volume !== undefined && Math.abs(now.volume - volume) <= VOLUME_EPS,
          reply,
          ...(volumeNote ? { note: volumeNote } : {}),
        };
      }
      const applied = now[field] === requested;
      // Measured: with no impulse responses set up, SetConvolution says OK and nothing changes.
      const note =
        field === "convolution" && requested === true && !applied
          ? "HQPlayer didn't enable convolution: no impulse responses are set up there (Convolution → Engine setup in HQPlayer; not possible remotely)"
          : undefined;
      return { field, requested, actual: now[field], applied, reply, ...(note ? { note } : {}) };
    });

    // ---- 6. how to undo, by name ----------------------------------------------
    const prev: Change = {};
    for (const f of fields) if (f !== "volume") (prev as Record<string, unknown>)[f] = was[f];
    // A mode switch resets the rate (reported) and swaps the remembered filters.
    if (modeSwitched) prev.rate = was.rate;
    if (volume !== undefined) prev.volume = was.volume;

    const major = modeSwitched || (rateIdx !== undefined && rateIdx !== before.rate);
    return { results, prev, state: after, volumeSet: volume ?? null, major, skipped: problems };
  }

  /**
   * Transport: play, pause, stop, previous, next. When Roon drives HQPlayer these
   * act underneath Roon, which may or may not follow. Measured: Play doesn't
   * restart an instance stalled by an invalid combination.
   */

  private watch(timing: WatchTiming): Promise<Verdict> {
    return watchPlayback(async () => {
      const s = await this.client.status();
      return { state: s.state, position: s.position };
    }, timing);
  }

  /** Does a known HQPlayer rule explain why the current settings can't play? */
  async explain(): Promise<Hint | undefined> {
    const [caps, state, status] = await Promise.all([this.capabilities(true), this.client.state(), this.client.status()]);
    // A track that can't start has no source in Status (measured): use the queued one.
    const source =
      status.source?.sampleRate ??
      (await this.client
        .request(cmd.playlistGet())
        .then((el) => queuedRate(el, status.track))
        .catch(() => null));
    if (!source) return undefined;
    const s = settingsOf(caps, state);
    const filter = filterSlot(source) === "1x" ? s.filter1x : s.filterNx;
    return predictedStop({
      mode: s.mode,
      filter,
      shaper: s.shaper,
      sourceRate: source,
      outputRate: status.activeRate,
      filterDescription: caps.filters.find((f) => f.name === filter)?.description,
    });
  }

  private async recordFailure(reason: string) {
    const [caps, state, status] = await Promise.all([this.capabilities(true), this.client.state(), this.client.status()]);
    const s = settingsOf(caps, state);
    const combo: Combo = {
      mode: s.mode,
      rateHz: status.activeRate,
      filterNx: s.filterNx,
      filter1x: s.filter1x,
      shaper: s.shaper,
    };
    this.learned.record({ ...combo, instance: this.instanceId, engine: caps.engine, reason, at: new Date().toISOString() });
  }
}
