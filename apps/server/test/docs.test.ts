// Storage (docs.ts, file-docs.ts): how documents load, save in order, fail and are set aside.
// The stores' own round trips through files are in learned/history/presets/settings tests.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { DocWriter, MemoryDocs, loadDoc, type DocStore } from "@app/core";
import { FileDocs } from "../src/file-docs.ts";
import { HistoryStore } from "@app/core";
import { LearnedStore } from "@app/core";
import { PresetStore } from "@app/core";
import { client } from "./http.ts";

afterEach(() => vi.restoreAllMocks());

/** Writes that finish when the test says, in whatever order it says. */
function gated() {
  const docs = new MemoryDocs();
  const pending: { text: string; finish: () => void }[] = [];
  const store: DocStore = {
    read: (n) => docs.read(n),
    setAside: (n) => docs.setAside(n),
    write: (n, text) => new Promise<void>((finish) => pending.push({ text, finish: () => (docs.docs.set(n, text), finish()) })),
  };
  return { docs, store, pending };
}

describe("saving a document", () => {
  it("writes one at a time, in order, so the latest lands last", async () => {
    const { docs, store, pending } = gated();
    const w = new DocWriter(store, "x.json");
    void w.write("one");
    void w.write("two");
    await Promise.resolve();
    expect(pending.map((p) => p.text)).toEqual(["one"]); // the second waits for the first
    pending[0]!.finish();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.finish();
    await w.flush();
    expect(docs.docs.get("x.json")).toBe("two");
  });

  it("in the background, logs a failed write and carries on (nothing thrown, nothing unhandled)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const docs = new MemoryDocs();
    const store: DocStore = {
      ...docs,
      read: (n) => docs.read(n),
      setAside: (n) => docs.setAside(n),
      write: (n, t) => (fail ? Promise.reject(new Error("disk full")) : docs.write(n, t)),
    };
    const w = new DocWriter(store, "learned.json");
    w.writeQuietly("a");
    await w.flush();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not save learned.json: disk full/));
    fail = false;
    w.writeQuietly("b"); // a failure doesn't jam the ones after it
    await w.flush();
    expect(docs.docs.get("learned.json")).toBe("b");
  });
});

describe("loading a document", () => {
  it("reads a missing one as nothing (normal), and a good one as it is", async () => {
    const docs = new MemoryDocs();
    expect(await loadDoc(docs, "presets.json", "presets")).toBeNull();
    await docs.write("presets.json", '{"format":1,"presets":[]}');
    expect(await loadDoc(docs, "presets.json", "presets")).toEqual({ format: 1, presets: [] });
  });

  it.each([
    ["bad JSON", '{"presets": [ {"id":"a",} ]}'],
    ["no such list", '{"format":1}'],
  ])("sets aside one with %s, never to be overwritten, and says where", async (_why, text) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const docs = new MemoryDocs();
    await docs.write("presets.json", text);
    expect(await loadDoc(docs, "presets.json", "presets")).toBeNull();
    expect(docs.docs.get("presets.json.corrupt")).toBe(text);
    expect(docs.docs.has("presets.json")).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not read presets.json .* moved it to presets.json.corrupt/));
  });

  it("sets aside one that can't be read at all", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const docs = new MemoryDocs();
    const aside = vi.fn(async () => "elsewhere");
    const store: DocStore = {
      read: () => Promise.reject(new Error("permission denied")),
      write: (n, t) => docs.write(n, t),
      setAside: aside,
    };
    expect(await loadDoc(store, "history.json", "entries")).toBeNull();
    expect(aside).toHaveBeenCalledWith("history.json");
  });
});

describe("stores over any storage", () => {
  it("learned and history round-trip through memory documents, as a phone app would keep them", async () => {
    const docs = new MemoryDocs();
    const l = await LearnedStore.open(docs);
    l.recordSlow({
      instance: "mac",
      engine: "5.35.10",
      mode: "PCM",
      rateHz: 384000,
      filter: "sinc-L",
      sourceRate: 44100,
      busyMs: 9400,
      at: "2026-10-10T00:00:00.000Z",
    });
    const h = await HistoryStore.open(docs);
    h.push({
      at: "2026-10-10T00:00:00.000Z",
      instance: "mac",
      source: "hqpweb",
      changes: [{ field: "filter1x", from: "a", to: "b" }],
    });
    await Promise.all([l.flush(), h.flush()]);
    expect((await LearnedStore.open(docs)).slowFor("mac", "5.35.10", "PCM", false)).toHaveLength(1);
    expect((await HistoryStore.open(docs)).forInstance("mac")).toHaveLength(1);
  });
});

describe("files (file-docs.ts)", () => {
  it("replaces a file whole and leaves no temporary file, even over a leftover one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docs-"));
    writeFileSync(join(dir, "presets.json.tmp"), "left by a crash");
    const docs = new FileDocs(dir);
    await docs.write("presets.json", "new");
    expect(readFileSync(join(dir, "presets.json"), "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["presets.json"]);
  });

  it("creates the directory on the first save", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "docs-")), "config");
    await new FileDocs(dir).write("instances.json", "{}");
    expect(readdirSync(dir)).toEqual(["instances.json"]);
  });
});

describe("a save that fails where it was asked for", () => {
  const failing = (): DocStore => {
    const docs = new MemoryDocs();
    return {
      read: (n) => docs.read(n),
      setAside: (n) => docs.setAside(n),
      write: () => Promise.reject(new Error("read-only file system")),
    };
  };
  let app: ReturnType<typeof buildApp>;
  afterEach(async () => app.close());

  it("a preset: the request fails, not silently", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    app = buildApp({ instances: [] }, { presets: await PresetStore.open(failing()) });
    const req = client(await app.listen(0, "127.0.0.1"));
    expect((await req("POST", "/api/presets", { body: { name: "Night", settings: { invert: true } } })).status).toBe(500);
  });

  it("an instance: the request fails, not silently", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    app = buildApp({ instances: [] }, { docs: failing() });
    const req = client(await app.listen(0, "127.0.0.1"));
    expect((await req("POST", "/api/instances", { body: { name: "Office", host: "192.0.2.10", port: 14399 } })).status).toBe(500);
  });
});
