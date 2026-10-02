// HQPlayer's own library (LibraryGet, measured on Desktop 5.32.5): albums
// (<LibraryDirectory>) with their tracks (<LibraryFile>) nested inside.
// Browsing is unauthenticated. Loading an album (LibraryLoad) is only sent by the
// SDK with a session key; we queue files with PlaylistAdd instead. Measured on
// Desktop 5.35.10: a plain-path PlaylistAdd is accepted without a session, but
// only start="1" makes the playlist the active transport (otherwise Play keeps
// using the previous source, e.g. Roon's stream).
import { connect } from "node:net";
import { element, PROLOG, type Element } from "./xml.ts";

export interface LibraryTrack {
  hash: string;
  /** File name within the album folder. */
  name: string;
  song: string;
  number?: number;
  /** Seconds. */
  length?: number;
  artist?: string;
  composer?: string;
  performer?: string;
}

export interface LibraryAlbum {
  hash: string;
  /** Folder on the HQPlayer machine. */
  path: string;
  album: string;
  artist?: string;
  composer?: string;
  performer?: string;
  date?: string;
  genre?: string;
  rate?: number;
  bits?: number;
  channels?: number;
  tracks: LibraryTrack[];
}

const opt = (v: string | undefined) => (v === undefined || v === "" ? undefined : v);
const optNum = (v: string | undefined) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function parseLibrary(el: Element): LibraryAlbum[] {
  return el.children
    .filter((d) => d.name === "LibraryDirectory")
    .map((d) =>
      clean({
        hash: d.attrs.hash ?? "",
        path: d.attrs.path ?? "",
        album: d.attrs.album ?? "",
        artist: opt(d.attrs.artist),
        composer: opt(d.attrs.composer),
        performer: opt(d.attrs.performer),
        date: opt(d.attrs.date),
        genre: opt(d.attrs.genre),
        rate: optNum(d.attrs.rate),
        bits: optNum(d.attrs.bits),
        channels: optNum(d.attrs.channels),
        tracks: d.children
          .filter((f) => f.name === "LibraryFile")
          .map((f) =>
            clean({
              hash: f.attrs.hash ?? "",
              name: f.attrs.name ?? "",
              song: f.attrs.song ?? "",
              number: optNum(f.attrs.number),
              length: optNum(f.attrs.length),
              artist: opt(f.attrs.artist),
              composer: opt(f.attrs.composer),
              performer: opt(f.attrs.performer),
            }),
          ),
      }),
    );
}

export const libraryCmd = {
  get: () => element("LibraryGet", { pictures: 0 }),
  pictureByHash: (hash: string) => element("LibraryPicture", { hash }),
  /**
   * Queue a URI: a plain file path on the HQPlayer machine works (measured), or a URL.
   * start: make the playlist the active transport (needed for the first item).
   */
  playlistAdd: (uri: string, opts: { queued?: boolean; clear?: boolean; start?: boolean } = {}) =>
    element("PlaylistAdd", { uri, queued: opts.queued ?? false, clear: opts.clear ?? false, start: opts.start ?? false, freewheel: 0 }),
  playlistClear: () => element("PlaylistClear"),
  selectTrack: (index: number) => element("SelectTrack", { index }),
};

/**
 * Cover art: the reply line <LibraryPicture size="N" type="…"/> is followed by N
 * raw bytes (SDK source). Uses its own connection so the binary payload can never
 * desynchronise the shared line-based one. size="0" (no art) is common: measured
 * on every album tried on the Mac.
 */
export function fetchPicture(host: string, port: number, hash: string, timeoutMs = 10_000): Promise<{ type: string; data: Buffer } | null> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let buf = Buffer.alloc(0);
    let need: number | null = null;
    let type = "application/octet-stream";
    let lineEnd = -1;
    const done = (err: Error | null, v?: { type: string; data: Buffer } | null) => {
      sock.destroy();
      if (err) reject(err);
      else resolve(v ?? null);
    };
    sock.setTimeout(timeoutMs, () => done(new Error("timeout fetching picture")));
    sock.on("connect", () => sock.write(PROLOG + libraryCmd.pictureByHash(hash) + "\n"));
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (need === null) {
        lineEnd = buf.indexOf(0x0a);
        if (lineEnd < 0) return;
        const line = buf.subarray(0, lineEnd).toString("utf8");
        need = Number(/size="(\d+)"/.exec(line)?.[1] ?? 0);
        type = /type="([^"]+)"/.exec(line)?.[1] ?? type;
        if (!need) return done(null, null);
      }
      if (buf.length - (lineEnd + 1) >= need) done(null, { type, data: buf.subarray(lineEnd + 1, lineEnd + 1 + need) });
    });
    sock.on("error", (e) => done(e));
    sock.on("close", () => done(new Error("connection closed before the picture arrived")));
  });
}
