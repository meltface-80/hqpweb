// The web app keeps its own copy of the server's "can stop playback" list (it labels a
// change "checking playback"). This keeps the two from drifting apart.
import { expect, it } from "vitest";
import { RISKY as server } from "../apps/server/src/instance.ts";
import { RISKY as web } from "../apps/web/src/lib/control.ts";

it("the web app's risky-change list matches the server's", () => {
  expect([...web].sort()).toEqual([...server].sort());
});
