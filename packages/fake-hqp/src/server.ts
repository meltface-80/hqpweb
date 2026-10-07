// The fake's network side: TCP control connections (newline-framed requests, answered
// in order) and UDP discovery. Split from fake.ts, unchanged in behaviour; the fake
// supplies the answers through `Endpoint`.
import { createServer, type Server, type Socket } from "node:net";
import { createSocket, type Socket as UdpSocket } from "node:dgram";

export interface Endpoint {
  /** Answer one request document. */
  handle(requestXml: string): Promise<string>;
  /** The reply to a discovery probe, or null to drop it (simulated UDP loss). */
  discoverReply(): string | null;
  /** Close a connection idle this long (read when it opens). */
  idleTimeoutMs(): number;
  /** The wait before answering a connection's first request (measured, scaled by the fake). */
  firstRequest(): Promise<void>;
}

export class ControlServer {
  private server?: Server;
  private udp?: UdpSocket;
  readonly sockets = new Set<Socket>(); // open control connections
  connections = 0; // accepted so far

  private readonly endpoint: Endpoint;

  constructor(endpoint: Endpoint) {
    this.endpoint = endpoint;
  }

  /** The bound TCP port, once listening. */
  get port(): number {
    const a = this.server?.address();
    if (!a || typeof a !== "object") throw new Error("not listening");
    return a.port;
  }

  /** Listen for TCP control connections. Defaults to loopback on an ephemeral port. */
  listen(port = 0, host = "127.0.0.1"): Promise<{ host: string; port: number }> {
    const server = createServer((sock) => this.serve(sock));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        const a = server.address();
        resolve({ host, port: typeof a === "object" && a ? a.port : port });
      });
    });
  }

  private serve(sock: Socket) {
    this.connections++;
    this.sockets.add(sock);
    let first = true;
    sock.setEncoding("utf8");
    sock.setTimeout(this.endpoint.idleTimeoutMs(), () => sock.destroy());
    sock.on("close", () => this.sockets.delete(sock));
    sock.on("error", () => sock.destroy());
    let buf = "";
    let chain = Promise.resolve();
    sock.on("data", (d: string) => {
      buf += d;
      let nl: number;
      // Inferred: requests are framed by newline, as clients send them. Several per
      // connection are allowed and answered in order.
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        chain = chain.then(async () => {
          if (first) {
            first = false;
            await this.endpoint.firstRequest();
          }
          const reply = await this.endpoint.handle(line);
          if (!sock.destroyed) sock.write(reply + "\n");
        });
      }
    });
  }

  /**
   * Answer `<discover>hqplayer</discover>` on UDP. Off by default: on a machine that
   * runs a real HQPlayer, joining its multicast group would make the fake discoverable
   * next to it. Reply shape measured.
   */
  listenDiscovery(port = 0, group = "239.192.0.199"): Promise<number> {
    const udp = createSocket({ type: "udp4", reuseAddr: true });
    this.udp = udp;
    udp.on("message", (msg, rinfo) => {
      if (!msg.toString().includes("<discover>hqplayer</discover>")) return;
      const reply = this.endpoint.discoverReply();
      if (reply !== null) udp.send(reply, rinfo.port, rinfo.address);
    });
    return new Promise((resolve) =>
      udp.bind(port, () => {
        try {
          udp.addMembership(group);
        } catch {
          // Loopback-only setups may not support multicast; unicast still works.
        }
        resolve(udp.address().port);
      }),
    );
  }

  async close() {
    for (const s of this.sockets) s.destroy();
    this.udp?.close();
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
  }
}
