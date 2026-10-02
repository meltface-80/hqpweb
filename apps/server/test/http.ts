// Minimal HTTP client for tests: full control over Host and Origin headers.
import { request as httpRequest } from "node:http";

export interface Res {
  status: number;
  json: () => any;
  text: () => string;
  headers: Record<string, string | string[] | undefined>;
}

export function client(base: string) {
  const u = new URL(base);
  return function request(
    method: string,
    path: string,
    opts: { body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
  ): Promise<Res> {
    const payload = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const headers: Record<string, string> = { ...(payload !== undefined && opts.rawBody === undefined ? { "content-type": "application/json" } : {}), ...opts.headers };
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: u.hostname, port: u.port, method, path, headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, json: () => JSON.parse(text), text: () => text }));
      });
      req.on("error", reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  };
}
