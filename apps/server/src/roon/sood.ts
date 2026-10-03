// SOOD: how Roon Cores are found on the LAN. UDP to port 9003, multicast
// 239.255.90.90 plus broadcast; cores answer the sender directly. Protocol as in
// Roon's Apache-2.0 node-roon-api (sood.js); no code copied. Like HQPlayer
// discovery, it doesn't cross VLANs or routed subnets: enter the address instead.
import { createSocket } from "node:dgram";
import { randomUUID } from "node:crypto";

const SOOD_PORT = 9003;
const SOOD_MULTICAST = "239.255.90.90";
/** The service id Roon Cores answer to. */
export const ROON_CORE_SERVICE = "00720724-5143-4a9b-abac-0e50cba674bb";

export interface FoundCore {
  /** Address the reply came from. */
  host: string;
  /** The core's extension API port (its http_port). */
  port: number;
  name?: string;
  version?: string;
  uniqueId?: string;
}

/** "SOOD", version 2, type letter, then (1-byte name length, name, 2-byte value length, value)… */
export function encodeQuery(props: Record<string, string>): Buffer {
  const parts: Buffer[] = [Buffer.from("SOOD"), Buffer.from([2]), Buffer.from("Q")];
  for (const [k, v] of Object.entries(props)) {
    const name = Buffer.from(k, "utf8");
    const value = Buffer.from(v, "utf8");
    parts.push(Buffer.from([name.length]), name, Buffer.from([value.length >> 8, value.length & 0xff]), value);
  }
  return Buffer.concat(parts);
}

export function decodePacket(buf: Buffer): { type: string; props: Record<string, string | null> } | null {
  if (buf.length < 6 || buf.toString("latin1", 0, 4) !== "SOOD" || buf[4] !== 2) return null;
  const type = String.fromCharCode(buf[5]!);
  const props: Record<string, string | null> = {};
  let pos = 6;
  while (pos < buf.length) {
    const nlen = buf[pos++]!;
    if (nlen === 0 || pos + nlen > buf.length) return null;
    const name = buf.toString("utf8", pos, pos + nlen);
    pos += nlen;
    if (pos + 2 > buf.length) return null;
    const vlen = (buf[pos]! << 8) | buf[pos + 1]!;
    pos += 2;
    if (vlen === 0xffff) props[name] = null;
    else {
      if (pos + vlen > buf.length) return null;
      props[name] = buf.toString("utf8", pos, pos + vlen);
      pos += vlen;
    }
  }
  return { type, props };
}

/** Asks the LAN for Roon Cores and collects answers for `timeoutMs`. */
export function discoverCores({
  timeoutMs = 1500,
  target,
}: { timeoutMs?: number; target?: { address: string; port: number } } = {}): Promise<FoundCore[]> {
  return new Promise((resolve) => {
    const found = new Map<string, FoundCore>();
    const sock = createSocket({ type: "udp4" });
    const done = () => {
      try {
        sock.close();
      } catch {}
      resolve([...found.values()]);
    };
    sock.on("error", done);
    sock.on("message", (msg, rinfo) => {
      const p = decodePacket(msg);
      if (!p || p.type !== "R" || p.props.service_id !== ROON_CORE_SERVICE) return;
      const port = Number(p.props.http_port);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
      // The address the reply actually came from, not the one it claims: a spoofed
      // `_replyaddr` could otherwise point the app at any host.
      const host = rinfo.address;
      const core: FoundCore = { host, port };
      if (p.props.name) core.name = p.props.name;
      if (p.props.display_version) core.version = p.props.display_version;
      if (p.props.unique_id) core.uniqueId = p.props.unique_id;
      found.set(core.uniqueId ?? `${host}:${port}`, core);
    });
    sock.bind(0, () => {
      const query = encodeQuery({ query_service_id: ROON_CORE_SERVICE, _tid: randomUUID() });
      if (target) sock.send(query, target.port, target.address);
      else {
        sock.setBroadcast(true);
        sock.setMulticastTTL(1);
        sock.send(query, SOOD_PORT, SOOD_MULTICAST);
        sock.send(query, SOOD_PORT, "255.255.255.255");
      }
      setTimeout(done, timeoutMs);
    });
  });
}
