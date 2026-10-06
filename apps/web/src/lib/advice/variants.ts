// What each modulator in the EC line and AHM is like, as Signalyst has described it: CPU
// load and character, each cited. Character choices, not a ranking: all four EC variants
// are one quality tier (RULES.variantsEqual). No note where nothing is documented.
import { RULES, type Rule } from "./policy.ts";

export interface VariantNote {
  /** Relative CPU load within its family; null when Signalyst hasn't said. */
  load: "lightest" | "light" | "a bit more than -light" | "heaviest" | null;
  rules: Rule[];
}

const EC: Record<string, VariantNote> = {
  ul: { load: "lightest", rules: [RULES.ulPi, RULES.ulEss] },
  light: { load: "light", rules: [RULES.lightDesign] },
  fast: { load: "a bit more than -light", rules: [RULES.fastTransients] },
  super: { load: "heaviest", rules: [RULES.superDesign, RULES.superFit] },
};

export function variantNote(name: string): VariantNote | null {
  const ec = /^ASDM[57]EC-(ul|light|fast|super)( 512\+fs)?$/.exec(name);
  if (ec) return EC[ec[1]!] ?? null;
  if (/^AHM[57]EC4B$/.test(name)) return { load: null, rules: [RULES.ahm4bNew] };
  if (/^AHM[57]EC8B$/.test(name)) return { load: "light", rules: [RULES.ahm8bLight] };
  return null;
}

/** AHM's floor (manual): DSD1024 and up. */
const DSD1024_HZ = 40_960_000;

/**
 * Heavy, by Signalyst's word, not by this machine: the EC line at DSD1024 needs a
 * high-clock CPU. Information shown before the change, never a refusal.
 */
export function heavyAt(name: string, rateHz: number): Rule | null {
  // "Regular modulators" in Signalyst's words: everything but AHM.
  return rateHz >= DSD1024_HZ && /^(ASDM|DSD|AMSDM)/.test(name) ? RULES.ecAt1024 : null;
}
