// HQPlayer's control protocol is one XML document per request and one
// newline-terminated XML document per reply (design §2.1, measured).
import { XMLParser } from "fast-xml-parser";

export interface Element {
  name: string;
  /** Attribute values are always kept as strings; callers convert explicitly. */
  attrs: Record<string, string>;
  text: string;
  children: Element[];
}

export const PROLOG = '<?xml version="1.0" encoding="UTF-8"?>';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  ignoreDeclaration: true,
});

type Node = Record<string, unknown> & { ":@"?: Record<string, string> };

function toElement(node: Node): Element | null {
  const name = Object.keys(node).find((k) => k !== ":@");
  if (name === undefined || name === "#text") return null;
  const body = (node[name] ?? []) as Node[];
  const el: Element = { name, attrs: { ...(node[":@"] ?? {}) }, text: "", children: [] };
  for (const child of body) {
    if ("#text" in child) el.text += String(child["#text"]);
    else {
      const c = toElement(child);
      if (c) el.children.push(c);
    }
  }
  return el;
}

/** Parse one XML document and return its root element. */
export function parseDocument(xml: string): Element {
  const nodes = parser.parse(xml) as Node[];
  for (const n of nodes) {
    const el = toElement(n);
    if (el) return el;
  }
  throw new Error(`no root element in reply: ${xml.slice(0, 120)}`);
}

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type AttrValue = string | number | boolean;

/** Serialise a single element, e.g. `<SetFilter value="51" value1x="49"/>`. */
export function element(name: string, attrs: Record<string, AttrValue> = {}, text?: string): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(typeof v === "boolean" ? (v ? "1" : "0") : String(v))}"`)
    .join("");
  return text === undefined ? `<${name}${a}/>` : `<${name}${a}>${escapeText(text)}</${name}>`;
}
