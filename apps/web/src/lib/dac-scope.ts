// Named DACs behind one HQPlayer, as the screens need them. The model and its rules are
// the server's (apps/server/src/dac-scope.ts, after MusicD-Remote's); this is the web side.
import type { Inst } from "./api.ts";

export const MAIN = "main";

/** Where a DAC's answers, failures and own presets are kept: same rule as the server. */
export const scopeOf = (instanceId: string, dacId: string | undefined) =>
  !dacId || dacId === MAIN ? instanceId : `${instanceId}#${dacId}`;

/** More than one DAC is named: show the DAC picker and "this DAC only". */
export const hasDacs = (i: Pick<Inst, "dacs"> | null | undefined) => (i?.dacs?.length ?? 0) > 1;

/** The DAC in use's name, or "" with just the one. */
export const dacName = (i: Pick<Inst, "dacs" | "dac"> | null | undefined) =>
  hasDacs(i) ? (i!.dacs.find((d) => d.id === i!.dac)?.name ?? "") : "";
