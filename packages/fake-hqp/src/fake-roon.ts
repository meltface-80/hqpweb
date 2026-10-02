// A fake Roon Core for development and tests: just enough of the extension API
// (registry, transport zones and control, image over HTTP) to exercise hqpweb's
// Roon link. Behaviour copied from measurements on a real core:
// - registration waits until the extension is approved, then replies Registered
//   with a token; a known token skips approval;
// - one connection per extension id: a new one makes the core send the older one
//   an empty frame and close it;
// - HQPlayer zones have an output source control named "HQPlayer".
// Zone names and tracks are invented.
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { Socket } from "node:net";

export interface FakeZone {
  zone_id: string;
  display_name: string;
  state: "playing" | "paused" | "stopped" | "loading";
  hqplayer?: boolean;
  track?: { line1: string; line2: string; line3: string; length: number; seek: number; image_key: string };
}

const DEFAULT_ZONES: FakeZone[] = [
  {
    zone_id: "zone-hqp",
    display_name: "Listening Room",
    state: "playing",
    hqplayer: true,
    track: { line1: "Example Track", line2: "Example Artist", line3: "Example Album", length: 300, seek: 12, image_key: "img1" },
  },
  {
    zone_id: "zone-kitchen",
    display_name: "Kitchen",
    state: "stopped",
    track: { line1: "Other Track", line2: "Other Artist", line3: "Other Album", length: 200, seek: 0, image_key: "img2" },
  },
];

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

interface Conn {
  socket: Socket;
  extensionId?: string;
  pendingRegister?: { id: string; body: Record<string, unknown> };
  zoneSubs: string[];
  nextId: number;
  pingReplies: number;
}

function frame(payload: Buffer, opcode = 2): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, payload]);
}

function moo(verb: string, name: string, id: string | number, body?: unknown): Buffer {
  let h = `MOO/1 ${verb} ${name}\nRequest-Id: ${id}\n`;
  if (body === undefined) return Buffer.from(h + "\n");
  const data = Buffer.from(JSON.stringify(body));
  h += `Content-Length: ${data.length}\nContent-Type: application/json\n\n`;
  return Buffer.concat([Buffer.from(h), data]);
}

function parseMoo(buf: Buffer) {
  const end = buf.indexOf("\n\n");
  const lines = buf.toString("utf8", 0, end).split("\n");
  const [, verb, rest] = /^MOO\/1 (\S+) (.+)$/.exec(lines[0]!)!;
  const headers = Object.fromEntries(lines.slice(1).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  const body = headers["Content-Length"] ? JSON.parse(buf.toString("utf8", end + 2)) : undefined;
  return { verb: verb!, name: rest!, id: headers["Request-Id"]!, body };
}

export class FakeRoon {
  readonly coreId = "fake-core-0001";
  zones: FakeZone[];
  /** Approved extension ids, and the tokens handed out. */
  approved = new Set<string>();
  tokens = new Map<string, string>();
  readonly log: string[] = [];
  private server: Server;
  private conns = new Set<Conn>();

  constructor(opts: { zones?: FakeZone[] } = {}) {
    this.zones = structuredClone(opts.zones ?? DEFAULT_ZONES);
    this.server = createServer((req, res) => {
      const m = /^\/api\/image\/([^/?]+)/.exec(req.url ?? "");
      if (m && this.zones.some((z) => z.track?.image_key === m[1])) {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(PNG);
      }
      res.writeHead(404).end();
    });
    this.server.on("upgrade", (req, socket: Socket) => {
      if (req.url !== "/api") return socket.destroy();
      const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const conn: Conn = { socket, zoneSubs: [], nextId: 1000, pingReplies: 0 };
      this.conns.add(conn);
      let buf = Buffer.alloc(0);
      socket.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          const opcode = buf[0]! & 0x0f;
          let len = buf[1]! & 0x7f;
          let off = 2;
          if (len === 126) (len = buf.readUInt16BE(2)), (off = 4);
          else if (len === 127) (len = Number(buf.readBigUInt64BE(2))), (off = 10);
          const masked = (buf[1]! & 0x80) !== 0;
          const need = off + (masked ? 4 : 0) + len;
          if (buf.length < need) return;
          const mask = masked ? buf.subarray(off, off + 4) : null;
          const payload = Buffer.from(buf.subarray(off + (masked ? 4 : 0), need));
          if (mask) for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!;
          buf = buf.subarray(need);
          if (opcode === 8) return socket.end(frame(Buffer.alloc(0), 8));
          if (opcode === 9) socket.write(frame(payload, 10));
          else if (opcode === 1 || opcode === 2) this.onMessage(conn, payload);
        }
      });
      socket.on("close", () => this.conns.delete(conn));
      socket.on("error", () => {});
    });
  }

  listen(port = 0, host = "127.0.0.1"): Promise<number> {
    return new Promise((r) => this.server.listen(port, host, () => r((this.server.address() as { port: number }).port)));
  }

  async close() {
    for (const c of this.conns) c.socket.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  /** The user clicks Enable in Roon → Settings → Extensions. */
  approve(extensionId?: string) {
    for (const c of this.conns) {
      if (!c.pendingRegister || (extensionId && c.extensionId !== extensionId)) continue;
      this.approved.add(c.extensionId!);
      this.registered(c, c.pendingRegister.id);
      c.pendingRegister = undefined;
    }
  }

  /** Names of extensions waiting for approval. */
  waiting(): string[] {
    return [...this.conns].filter((c) => c.pendingRegister).map((c) => String(c.pendingRegister!.body.display_name));
  }

  /** Sends the extension a ping, as the core does; counts replies. */
  ping(): void {
    for (const c of this.conns) c.socket.write(frame(moo("REQUEST", "com.roonlabs.ping:1/ping", c.nextId++)));
  }
  pingReplies(): number {
    return [...this.conns].reduce((n, c) => n + c.pingReplies, 0);
  }

  /** Changes a zone and tells subscribers. */
  update(zoneId: string, change: Partial<FakeZone>) {
    const z = this.zones.find((z) => z.zone_id === zoneId)!;
    Object.assign(z, change);
    this.broadcast({ zones_changed: [this.raw(z)] });
  }

  private raw(z: FakeZone) {
    const t = z.track;
    return {
      zone_id: z.zone_id,
      display_name: z.display_name,
      state: z.state,
      is_play_allowed: z.state !== "playing",
      is_pause_allowed: z.state === "playing",
      is_next_allowed: true,
      is_previous_allowed: true,
      is_seek_allowed: !!z.track,
      outputs: [{ output_id: `${z.zone_id}-out`, source_controls: z.hqplayer ? [{ display_name: "HQPlayer" }] : [] }],
      ...(t
        ? { now_playing: { seek_position: t.seek, length: t.length, image_key: t.image_key, three_line: { line1: t.line1, line2: t.line2, line3: t.line3 } } }
        : {}),
    };
  }

  private broadcast(body: unknown) {
    for (const c of this.conns) for (const id of c.zoneSubs) c.socket.write(frame(moo("CONTINUE", "Changed", id, body)));
  }

  private registered(c: Conn, id: string) {
    const token = this.tokens.get(c.extensionId!) ?? randomUUID();
    this.tokens.set(c.extensionId!, token);
    c.socket.write(frame(moo("COMPLETE", "Registered", id, { core_id: this.coreId, display_name: "Fake Core", display_version: "0.0", token })));
  }

  private onMessage(c: Conn, data: Buffer) {
    const m = parseMoo(data);
    this.log.push(`${m.verb} ${m.name}`);
    const reply = (verb: string, name: string, body?: unknown) => c.socket.write(frame(moo(verb, name, m.id, body)));
    if (m.verb !== "REQUEST") {
      if (m.name === "Success") c.pingReplies++;
      return;
    }
    switch (m.name) {
      case "com.roonlabs.registry:1/info":
        return reply("COMPLETE", "Success", { core_id: this.coreId, display_name: "Fake Core", display_version: "0.0 (fake)" });
      case "com.roonlabs.registry:1/register": {
        const b = m.body as Record<string, unknown>;
        c.extensionId = String(b.extension_id);
        // One connection per extension id: the older one gets an empty frame and is closed.
        for (const other of this.conns)
          if (other !== c && other.extensionId === c.extensionId) {
            other.socket.write(frame(Buffer.alloc(0)));
            other.socket.end();
          }
        if (b.token && this.tokens.get(c.extensionId) === b.token) return this.registered(c, m.id);
        if (this.approved.has(c.extensionId)) return this.registered(c, m.id);
        c.pendingRegister = { id: m.id, body: b };
        return;
      }
      case "com.roonlabs.transport:2/subscribe_zones":
        c.zoneSubs.push(m.id);
        return reply("CONTINUE", "Subscribed", { zones: this.zones.map((z) => this.raw(z)) });
      case "com.roonlabs.transport:2/control": {
        const b = m.body as { zone_or_output_id: string; control: string };
        const z = this.zones.find((z) => z.zone_id === b.zone_or_output_id);
        if (!z) return reply("COMPLETE", "InvalidRequest", { error: "no such zone" });
        if (b.control === "play" || (b.control === "playpause" && z.state !== "playing")) z.state = "playing";
        else if (b.control === "pause" || b.control === "playpause") z.state = "paused";
        else if ((b.control === "next" || b.control === "previous") && z.track) z.track.seek = 0;
        reply("COMPLETE", "Success");
        return this.broadcast({ zones_changed: [this.raw(z)] });
      }
      case "com.roonlabs.transport:2/seek": {
        const b = m.body as { zone_or_output_id: string; how: string; seconds: number };
        const z = this.zones.find((z) => z.zone_id === b.zone_or_output_id);
        if (!z?.track) return reply("COMPLETE", "InvalidRequest", { error: "nothing to seek" });
        z.track.seek = b.how === "relative" ? z.track.seek + b.seconds : b.seconds;
        reply("COMPLETE", "Success");
        return this.broadcast({ zones_seek_changed: [{ zone_id: z.zone_id, seek_position: z.track.seek }] });
      }
      default:
        return reply("COMPLETE", "InvalidRequest", { error: `unknown ${m.name}` });
    }
  }
}
