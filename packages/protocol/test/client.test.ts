import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { HqpClient, MAX_REPLY, rawRequest } from "../src/client.ts";

// A scripted peer: `onLine` decides what to do with each request line.
let server: Server | null = null;
const sockets: Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});
async function peer(onLine: (line: string, sock: Socket, n: number) => void): Promise<number> {
  let n = 0;
  server = createServer((sock) => {
    sockets.push(sock);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        onLine(line, sock, ++n);
      }
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  return (server!.address() as { port: number }).port;
}
const OK = (name: string) => `<?xml version="1.0" encoding="utf-8"?><${name} result="OK"/>\n`;

describe("HqpClient", () => {
  it("drops a peer whose reply never ends instead of buffering it", async () => {
    const port = await peer((_l, sock) => {
      const chunk = "x".repeat(1024 * 1024);
      for (let i = 0; i <= MAX_REPLY / chunk.length + 1; i++) sock.write(chunk);
    });
    const c = new HqpClient("127.0.0.1", { port, timeoutMs: 5000 });
    await expect(c.request("<State/>")).rejects.toThrow(/too long|closed/);
    c.close();
  });

  it("retries a setter on a stale connection, but never Next", async () => {
    const seen: string[] = [];
    const port = await peer((line, sock) => {
      const name = /<(\w+)/.exec(line.replace(/^<\?xml[^>]*\?>/, ""))?.[1] ?? "";
      seen.push(name);
      // The first request on each connection works; the next finds it closed.
      if (seen.filter((s) => s === name).length === 1 && name === "GetInfo") return sock.write(OK("GetInfo"));
      sock.destroy();
    });
    const c = new HqpClient("127.0.0.1", { port, timeoutMs: 2000 });
    await c.request("<GetInfo/>");
    await expect(c.request("<Next/>")).rejects.toThrow();
    expect(seen.filter((s) => s === "Next")).toHaveLength(1);
    c.close();

    seen.length = 0;
    const d = new HqpClient("127.0.0.1", { port, timeoutMs: 2000 });
    await d.request("<GetInfo/>");
    await expect(d.request('<SetFilter value="1"/>')).rejects.toThrow();
    expect(seen.filter((s) => s === "SetFilter")).toHaveLength(2); // retried once
    d.close();
  });
});

describe("a peer that accepts and closes without replying", () => {
  it("says so, and names the expired-trial cause", async () => {
    const port = await peer((_l, sock) => sock.destroy());
    const c = new HqpClient("127.0.0.1", { port, timeoutMs: 2000 });
    await expect(c.request("<GetInfo/>")).rejects.toThrow(/without replying.*trial/);
    c.close();
  });
});

describe("rawRequest", () => {
  it("gives up on an endless reply", async () => {
    const port = await peer((_l, sock) => {
      const chunk = "y".repeat(1024 * 1024);
      for (let i = 0; i <= MAX_REPLY / chunk.length + 1; i++) sock.write(chunk);
    });
    await expect(rawRequest("127.0.0.1", port, "<State/>", 5000)).rejects.toThrow(/too long/);
  });
});
