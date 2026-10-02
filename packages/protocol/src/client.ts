// One TCP connection per request: simple, and what every measurement used
// (design §2.1). HQPlayer closes idle sockets after ~156 s anyway.
import { connect } from "node:net";
import { cmd } from "./commands.ts";
import * as p from "./parse.ts";
import { PROLOG, parseDocument, type Element } from "./xml.ts";

export const DEFAULT_PORT = 4321;

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
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl >= 0) finish(null, buf.slice(0, nl));
    });
    sock.on("error", (e) => finish(e));
    sock.on("close", () => finish(new Error(`connection closed before a complete reply from ${host}:${port}`)));
  });
}

export class HqpClient {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;

  constructor(host: string, opts: ClientOptions = {}) {
    this.host = host;
    this.port = opts.port ?? DEFAULT_PORT;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async request(body: string): Promise<Element> {
    return parseDocument(await rawRequest(this.host, this.port, body, this.timeoutMs));
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
}
