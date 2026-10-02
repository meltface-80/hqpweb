// MOO: the message framing of Roon's extension API, one message per WebSocket
// binary frame. Written from Roon's Apache-2.0 node-roon-api (moo.js):
//
//   MOO/1 REQUEST com.roonlabs.transport:2/control
//   Request-Id: 7
//   Content-Length: 45
//   Content-Type: application/json
//
//   {"zone_or_output_id":"…","control":"next"}
//
// Verbs: REQUEST (either direction), CONTINUE (subscription updates), COMPLETE
// (final reply). A reply's name is its status: Success, Subscribed, Changed,
// Registered, or an error name.

export type Verb = "REQUEST" | "CONTINUE" | "COMPLETE";

export interface MooMessage {
  verb: Verb;
  /** For REQUEST: "service/method" split into the two. For replies: the status. */
  service?: string;
  name: string;
  requestId: string;
  headers: Record<string, string>;
  contentType?: string;
  /** Parsed JSON, raw bytes for other content types, undefined without a body. */
  body?: unknown;
}

export function encode(verb: Verb, name: string, requestId: number | string, body?: unknown): Uint8Array<ArrayBuffer> {
  let header = `MOO/1 ${verb} ${name}\nRequest-Id: ${requestId}\n`;
  let data: Buffer | undefined;
  if (body !== undefined) {
    data = Buffer.from(JSON.stringify(body), "utf8");
    header += `Content-Length: ${data.length}\nContent-Type: application/json\n`;
  }
  const head = Buffer.from(header + "\n", "utf8");
  const out = new Uint8Array(head.length + (data?.length ?? 0));
  out.set(head);
  if (data) out.set(data, head.length);
  return out;
}

/** Parses one message; throws on anything malformed (the caller drops the connection). */
export function decode(input: ArrayBuffer | Uint8Array | string): MooMessage {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  const end = buf.indexOf("\n\n");
  if (end < 0) throw new Error("MOO: no end of headers");
  const lines = buf.toString("utf8", 0, end).split("\n");
  const first = /^MOO\/\d+ (REQUEST|CONTINUE|COMPLETE) (.+)$/.exec(lines[0] ?? "");
  if (!first) throw new Error(`MOO: bad first line ${JSON.stringify(lines[0])}`);
  const verb = first[1] as Verb;
  let service: string | undefined;
  let name = first[2]!;
  if (verb === "REQUEST") {
    const slash = name.lastIndexOf("/");
    if (slash < 1) throw new Error(`MOO: bad request name ${name}`);
    service = name.slice(0, slash);
    name = name.slice(slash + 1);
  }
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const m = /^([^:]+): *(.*)$/.exec(line);
    if (!m) throw new Error(`MOO: bad header ${JSON.stringify(line)}`);
    headers[m[1]!] = m[2]!;
  }
  const requestId = headers["Request-Id"];
  if (requestId === undefined) throw new Error("MOO: missing Request-Id");
  const contentType = headers["Content-Type"];
  const lengthHeader = headers["Content-Length"];
  if ((contentType === undefined) !== (lengthHeader === undefined)) throw new Error("MOO: Content-Type and Content-Length go together");
  const msg: MooMessage = { verb, name, requestId, headers, ...(service ? { service } : {}) };
  if (lengthHeader !== undefined && contentType !== undefined) {
    const length = Number(lengthHeader);
    if (!Number.isInteger(length) || length < 0 || end + 2 + length > buf.length) throw new Error("MOO: bad Content-Length");
    const raw = buf.subarray(end + 2, end + 2 + length);
    msg.contentType = contentType;
    msg.body = contentType === "application/json" ? (length ? JSON.parse(raw.toString("utf8")) : undefined) : Buffer.from(raw);
  }
  return msg;
}
