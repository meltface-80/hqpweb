// Test-run guard: no test may connect to TCP 4321. On a dev machine that is a
// real HQPlayer someone is listening to; the fake uses other ports.
import net from "node:net";

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0]; // net.connect passes normalised args
  const port = typeof a === "object" && a !== null ? (a as { port?: unknown }).port : a;
  if (Number(port) === 4321) throw new Error("tests must never connect to port 4321 (a real HQPlayer)");
  return connect.apply(this, args as Parameters<typeof connect>);
} as typeof connect;
