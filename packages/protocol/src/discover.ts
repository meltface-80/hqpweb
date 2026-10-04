// HQPlayer discovery: UDP multicast to 239.192.0.199:4321 with
// <discover>hqplayer</discover>; each instance answers from its own address with
// <discover name="…" result="OK" version="…">hqplayer</discover> (measured).
// Multicast does not cross VLANs or routed subnets.
import { createSocket } from "node:dgram";
import { PROLOG, parseDocument } from "./xml.ts";

export const DISCOVERY_GROUP = "239.192.0.199";
export const DISCOVERY_PORT = 4321;

export interface Discovered {
  /** Address the reply came from. */
  address: string;
  name: string;
  /** e.g. "Signalyst HQPlayer Desktop 5". */
  version: string;
}

export interface DiscoverOptions {
  timeoutMs?: number;
  /** Where to send the probe. Default: the multicast group. Tests use unicast. */
  target?: { address: string; port: number };
  /** How many probes to send, spread over the first part of the wait. Default 3. */
  probes?: number;
}

export function discover(opts: DiscoverOptions = {}): Promise<Discovered[]> {
  const { address, port } = opts.target ?? { address: DISCOVERY_GROUP, port: DISCOVERY_PORT };
  const found = new Map<string, Discovered>();
  return new Promise((resolve) => {
    const sock = createSocket({ type: "udp4" });
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      try {
        sock.close();
      } catch {}
      resolve([...found.values()]);
    };
    sock.on("error", done);
    sock.on("message", (msg, rinfo) => {
      try {
        const el = parseDocument(msg.toString("utf8"));
        if (el.name !== "discover" || el.attrs.result !== "OK") return;
        found.set(rinfo.address, { address: rinfo.address, name: el.attrs.name ?? "", version: el.attrs.version ?? "" });
      } catch {
        // Not an HQPlayer reply; ignore.
      }
    });
    sock.bind(0, () => {
      try {
        sock.setMulticastTTL(2);
      } catch {}
      // UDP can drop a probe or a reply (a tester's scans failed several times before
      // one worked), so send a few, spread over the first half of the wait. Replies
      // are keyed by address, so repeats don't duplicate.
      const timeoutMs = opts.timeoutMs ?? 2000;
      const probes = Math.max(1, opts.probes ?? 3);
      for (let i = 0; i < probes; i++)
        setTimeout(
          () =>
            closed ||
            sock.send(PROLOG + "<discover>hqplayer</discover>", port, address, (err) => {
              if (err && i === 0) done();
            }),
          (i * timeoutMs) / (2 * probes),
        );
      setTimeout(done, timeoutMs);
    });
  });
}
