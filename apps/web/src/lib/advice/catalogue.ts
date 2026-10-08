// How the modulator and dither lists are grouped: by family, newest first, with the
// older series folded. Names come from the instance's own list; a name the rules don't
// know goes in its own section, so nothing HQPlayer offers is ever hidden.
import { RULES, type Rule } from "./policy.ts";

export interface Section {
  key: string;
  title: string;
  /** Names in HQPlayer's own order. */
  names: string[];
  /** Shown open; a folded section still shows the one in use. */
  open: boolean;
  /** A cited line under the heading, e.g. that the older series use more CPU for less. */
  note?: Rule;
}

type Family = "new" | "ahm" | "amsdm" | "olderEc" | "basic";

const FAMILY_TESTS: [Family, RegExp][] = [
  ["new", /^ASDM[57]EC-(ul|light|fast|super)( 512\+fs)?$/],
  ["ahm", /^AHM[57]EC(5L|8B|4B)$/],
  ["amsdm", /^AMSDM7(EC)? 512\+fs$/],
  ["olderEc", /^(DSD5EC|ASDM[57]EC(v[23])?)$/],
  ["basic", /^(DSD[57](v2)?( 256\+fs)?|ASDM[57])$/],
];
const FAMILY_TITLES: Record<Family, string> = {
  new: "Newest EC line",
  ahm: "AHM, for DSD1024 and up",
  amsdm: "AMSDM, pseudo-multi-bit",
  olderEc: "Older EC series",
  basic: "Basic",
};
const OPEN: Record<Family, boolean> = { new: true, ahm: true, amsdm: false, olderEc: false, basic: false };
const NOTES: Partial<Record<Family, Rule>> = { olderEc: RULES.olderGen, basic: RULES.basicGen };

export function modulatorFamily(name: string): Family | null {
  return FAMILY_TESTS.find(([, re]) => re.test(name))?.[0] ?? null;
}
/** A modulator's family as the list titles it, e.g. "Newest EC line"; null when unknown. */
export function familyTitle(name: string): string | null {
  const f = modulatorFamily(name);
  return f ? FAMILY_TITLES[f] : null;
}
/** A dither's group as the list titles it, e.g. "Flat dither"; null when unknown. */
export function ditherGroupTitle(name: string): string | null {
  return DITHER_GROUPS.find(([, , ns]) => ns.includes(name))?.[1] ?? null;
}
/** A modulator's order, from its name (ASDM7…, AHM5…); null when the name doesn't say. */
export const orderOf = (name: string): 5 | 7 | null => {
  const m = /^[A-Z]+([57])/.exec(name);
  return m ? (Number(m[1]) as 5 | 7) : null;
};

/**
 * Sections for the modulator list. With an order from the setup answers, each family
 * shows that order, and the other order goes in its own folded section at the end;
 * AHM shows both, since the DSD1024 choice differs by amplifier.
 */
export function groupModulators(names: string[], order: 5 | 7 | null): Section[] {
  const mine = (n: string) => order === null || modulatorFamily(n) === "ahm" || orderOf(n) === order;
  const sections: Section[] = (Object.keys(FAMILY_TITLES) as Family[]).map((f) => ({
    key: f,
    title: FAMILY_TITLES[f],
    names: names.filter((n) => modulatorFamily(n) === f && mine(n)),
    open: OPEN[f],
    ...(NOTES[f] ? { note: NOTES[f] } : {}),
  }));
  const unknown = names.filter((n) => modulatorFamily(n) === null);
  if (unknown.length) sections.push({ key: "unknown", title: "Newer than hqpweb's advice", names: unknown, open: true });
  if (order !== null) {
    const other = names.filter((n) => modulatorFamily(n) !== null && !mine(n));
    sections.push({ key: "other", title: order === 7 ? "Fifth order" : "Seventh order", names: other, open: false });
  }
  return sections.filter((s) => s.names.length);
}

const DITHER_GROUPS: [string, string, string[], boolean][] = [
  ["flat", "Flat dither", ["TPDF", "Gauss1"], true],
  ["shape", "Noise shaping, for ladder DACs", ["LNS15", "NS9", "NS5"], true],
  ["more", "More", ["NS4", "shaped", "NS1", "RPDF"], false],
  ["never", "Not for listening", ["none"], true],
];

/** Sections for the dither list; names HQPlayer lists but we don't know go in "More". */
export function groupDithers(names: string[]): Section[] {
  const known = new Set(DITHER_GROUPS.flatMap(([, , ns]) => ns));
  const sections = DITHER_GROUPS.map(([key, title, ns, open]) => ({
    key,
    title,
    names: ns.filter((n) => names.includes(n)).concat(key === "more" ? names.filter((n) => !known.has(n)) : []),
    open,
  }));
  return sections.filter((s) => s.names.length);
}

/**
 * The list as narrowed by a search and the "works here" chip: names that match the query
 * (any case), minus the hidden ones. A search opens the sections it matches in, folded or
 * not; sections left empty go.
 */
export function narrowSections(sections: Section[], query: string, hide: ReadonlySet<string>): Section[] {
  const q = query.trim().toLowerCase();
  if (!q && hide.size === 0) return sections;
  return sections
    .map((s) => ({
      ...s,
      names: s.names.filter((n) => !hide.has(n) && (!q || n.toLowerCase().includes(q))),
      open: s.open || !!q,
    }))
    .filter((s) => s.names.length);
}
