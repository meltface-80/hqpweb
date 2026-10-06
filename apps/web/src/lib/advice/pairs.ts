// Rate and modulator as one choice: for each DSD rate this instance lists, the starting
// point the guide gives at that rate, and whether the rate suits the DAC. Rate and
// modulator are one decision (AHM only at DSD1024 and up), so the guide offers them as
// pairs and applies each as one change. Decisions are modulator.ts's; this only asks it
// once per rate.
import { modulatorAdvice, type ModulatorInput } from "./modulator.ts";

export const DSD_RATES = [
  { label: "DSD256", hz: 11_289_600 },
  { label: "DSD512", hz: 22_579_200 },
  { label: "DSD1024", hz: 45_158_400 },
] as const;

type Start = NonNullable<ReturnType<typeof modulatorAdvice>["start"]>;

export interface Pair {
  label: (typeof DSD_RATES)[number]["label"];
  rateHz: number;
  start: Start;
  /** The rate the guide suggests for these answers (one of possibly several). */
  suitsDac: boolean;
}

export function modulatorPairs(input: Omit<ModulatorInput, "rateHz"> & { rates: number[] }): Pair[] {
  const pairs: Pair[] = [];
  for (const r of DSD_RATES) {
    if (!input.rates.includes(r.hz)) continue;
    const a = modulatorAdvice({ ...input, rateHz: r.hz });
    if (a.status === "needs-dac" || !a.start) continue;
    // At DSD1024 only AHM: the EC line doesn't suit that rate (Signalyst; see modulator.ts).
    if (r.label === "DSD1024" && !a.start.name.startsWith("AHM")) continue;
    const s = a.suggestedRate;
    const suitsDac =
      !!s && (s.label === r.label || (s.orDsd512 && r.label === "DSD512") || (s.orDsd1024 && r.label === "DSD1024"));
    pairs.push({ label: r.label, rateHz: r.hz, start: a.start, suitsDac });
  }
  // The rates that suit the DAC first; otherwise lowest rate first.
  return [...pairs.filter((p) => p.suitsDac), ...pairs.filter((p) => !p.suitsDac)];
}
