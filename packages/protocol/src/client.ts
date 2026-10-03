// The first request on a new connection costs 265–606 ms; later requests on the
// same connection take ~1 ms (measured 2026-10-02, both instances). So the client
// keeps one connection per instance and sends requests over it one at a time.
import { connect, type Socket } from "node:net";
import { cmd } from "./commands.ts";
import * as p from "./parse.ts";
import { libraryCmd, parseLibrary } from "./library.ts";
import { PROLOG, parseDocument, type Element } from "./xml.ts";

export const DEFAULT_PORT = 4321;
/**
 * Longest reply line accepted. Real replies are a few KB (filter lists ~10 KB);
 * a peer that sends more without a newline is broken or hostile, and is dropped
 * rather than buffered until the process runs out of memory.
 */
export const MAX_REPLY = 4 * 1024 * 1024;

/** Commands that change something relative to the current state: never resent. */
const NOT_IDEMPOTENT = new Set(["Next", "Previous", "Forward", "Backward", "VolumeUp", "VolumeDown", "VolumeMute", "PlaylistAdd", "PlaylistRemove", "PlaylistMoveUp", "PlaylistMoveDown"]);

export interface ClientOptions {
  port?: number;
  /** The first SetFilter blocked ~5 s while the filter was prepared (measured). */
  timeoutMs?: number;
}

/** Send one request document and return the raw reply line. */
export function rawRequest(host: string, port: number, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let buf = "";
    let done = false;
    const finish = (err: Error | null, line?: string) => {
      if (done) return;
      done = true;
      sock.destroy();
      if (err) reject(err);
      else resolve(line!);
    };
    sock.setEncoding("utf8");
    sock.setTimeout(timeoutMs, () => finish(new Error(`timeout after ${timeoutMs} ms waiting for ${host}:${port}`)));
    sock.on("connect", () => sock.write(PROLOG + body + "\n"));
    sock.on("data", (d: string) => {
      const nl = d.indexOf("\n");
      if (nl >= 0) return finish(null, buf + d.slice(0, nl));
      buf += d;
      if (buf.length > MAX_REPLY) finish(new Error(`reply from ${host}:${port} too long`));
    });
    sock.on("error", (e) => finish(e));
    sock.on("close", () => finish(new Error(`connection closed before a complete reply from ${host}:${port}`)));
  });
}

export class HqpClient {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  /** Close our idle connection before HQPlayer closes it (~156 s, measured). */
  readonly idleMs: number;

  private sock: Socket | null = null;
  private buf = "";
  private waiting: ((line: string) => void) | null = null;
  private failWaiting: ((e: Error) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  /** Connections opened so far (diagnostics and tests). */
  connections = 0;

  constructor(host: string, opts: ClientOptions & { idleMs?: number } = {}) {
    this.host = host;
    this.port = opts.port ?? DEFAULT_PORT;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.idleMs = opts.idleMs ?? 120_000;
  }

  /** Send one request and parse the reply. Requests are queued, one in flight at a time. */
  request(body: string): Promise<Element> {
    const run = this.queue.then(() => this.exchange(body));
    this.queue = run.catch(() => undefined);
    return run.then(parseDocument);
  }

  private async exchange(body: string): Promise<string> {
    const reused = this.sock !== null;
    try {
      return await this.once(body);
    } catch (e) {
      // A reused connection may have been closed by HQPlayer while idle. Retry once
      // on a fresh one, but only commands that are safe to repeat: setters carry
      // absolute values; Next, VolumeUp and the like don't.
      const name = /^<(\w+)/.exec(body)?.[1] ?? "";
      if (reused && (e as { stale?: boolean }).stale && !NOT_IDEMPOTENT.has(name)) return this.once(body);
      throw e;
    }
  }

  private async once(body: string): Promise<string> {
    const sock = await this.connected();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.drop();
        reject(new Error(`timeout after ${this.timeoutMs} ms waiting for ${this.host}:${this.port}`));
      }, this.timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.waiting = this.failWaiting = null;
        this.idleTimer = setTimeout(() => this.drop(), this.idleMs);
        this.idleTimer.unref();
      };
      this.waiting = (line) => {
        done();
        resolve(line);
      };
      this.failWaiting = (e) => {
        done();
        reject(e);
      };
      sock.write(PROLOG + body + "\n");
    });
  }

  private connected(): Promise<Socket> {
    if (this.sock) return Promise.resolve(this.sock);
    return new Promise((resolve, reject) => {
      const sock = connect({ host: this.host, port: this.port });
      sock.setEncoding("utf8");
      sock.setNoDelay(true);
      const fail = (e: Error) => {
        sock.destroy();
        reject(e);
      };
      sock.once("error", fail);
      sock.setTimeout(this.timeoutMs, () => fail(new Error(`timeout connecting to ${this.host}:${this.port}`)));
      sock.once("connect", () => {
        sock.off("error", fail);
        sock.setTimeout(0);
        this.connections++;
        this.sock = sock;
        this.buf = "";
        sock.on("data", (d: string) => {
          // Search only the new chunk for line ends: rescanning the whole buffer
          // on every chunk is quadratic.
          let start = 0;
          let nl: number;
          while ((nl = d.indexOf("\n", start)) >= 0) {
            const line = this.buf + d.slice(start, nl);
            this.buf = "";
            start = nl + 1;
            this.waiting?.(line);
          }
          this.buf += d.slice(start);
          if (this.buf.length > MAX_REPLY) {
            this.buf = "";
            sock.destroy(new Error(`reply from ${this.host}:${this.port} too long`));
          }
        });
        const lost = (e?: Error) => {
          if (this.sock === sock) this.sock = null;
          const err = Object.assign(e ?? new Error(`connection to ${this.host}:${this.port} closed`), { stale: true });
          this.failWaiting?.(err);
        };
        sock.on("error", lost);
        sock.on("close", () => lost());
        resolve(sock);
      });
    });
  }

  private drop() {
    this.sock?.destroy();
    this.sock = null;
  }

  /** Close the connection. The client reconnects on the next request. */
  close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.drop();
  }

  /** Send a command and report its outcome. An OK is NOT proof of effect: read State back. */
  async send(body: string): Promise<p.Outcome> {
    return p.outcome(await this.request(body));
  }

  info = async () => p.parseInfo(await this.request(cmd.getInfo()));
  state = async () => p.parseState(await this.request(cmd.state()));
  status = async () => p.parseStatus(await this.request(cmd.status()));
  modes = async () => p.parseModes(await this.request(cmd.getModes()));
  filters = async () => p.parseFilters(await this.request(cmd.getFilters()));
  shapers = async () => p.parseShapers(await this.request(cmd.getShapers()));
  rates = async () => p.parseRates(await this.request(cmd.getRates()));
  volumeRange = async () => p.parseVolumeRange(await this.request(cmd.volumeRange()));
  configurations = async () => p.parseConfigurationList(await this.request(cmd.configurationList()));
  matrixProfiles = async () => p.parseMatrixProfiles(await this.request(cmd.matrixListProfiles()));
  library = async () => parseLibrary(await this.request(libraryCmd.get()));
}
