// The web app keeps its own copy of the setup questions' answers (for the guide and
// Settings). This keeps it from drifting from what the server accepts.
import { expect, it } from "vitest";
import { ALLOWED as server } from "../apps/server/src/setup.ts";
import { SETUP_ANSWERS as web } from "../apps/web/src/lib/setup-answers.ts";

it("the web app's setup answers match the server's", () => {
  expect(web).toEqual(server);
});
