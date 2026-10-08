// Serves the built web app (apps/web/dist) in production. Hashed assets are
// cached for a year; index.html never, so a deploy is picked up on reload.
import { SECURITY_HEADERS } from "./headers.ts";
import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Returns false if nothing was served. Unknown paths fall back to index.html. HEAD gets the
 * same headers without the body: browsers may probe icons that way (Safari), and a 404
 * there reads as "no icon".
 */
export async function serveStatic(root: string, urlPath: string, res: ServerResponse, head = false): Promise<boolean> {
  const base = resolve(root);
  let file = resolve(join(base, normalize(decodeURIComponent(urlPath))));
  if (file !== base && !file.startsWith(base + sep)) return false; // path traversal
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    // Not a file: let the client-side app handle the route.
    if (extname(file)) return false;
    file = join(base, "index.html");
  }
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    return false;
  }
  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "content-length": body.length,
  });
  res.end(head ? undefined : body);
  return true;
}
