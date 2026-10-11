// The lanes every spec runs in (lanes.ts): the server ("web") or the phone app's page ("app"),
// in an engine. A spec asks what the running host can offer, as the page does (apps/web
// api.ts can), rather than which one it is; and changes its own lane's fakes.
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import type { HostCan } from "@app/contract";
import { APP_CAN, APP_NAME } from "../apps/mobile/src/can.ts";
import { SERVER_CAN } from "../apps/web/src/lib/api.ts";
import { CONTROL_PORT, lane } from "./lanes.ts";

const running = () => test.info().project.name;
const onApp = () => lane(running()).host === "app";

/** What the running host calls itself: hqpweb, or the phone app's name. */
export const appName = () => (onApp() ? APP_NAME : "hqpweb");

/** What the running host offers. */
export const can = (): HostCan => (onApp() ? APP_CAN : SERVER_CAN);

/** Where to change one of this lane's fakes, as HQPlayer or its owner would (stack.ts). */
export const fakeUrl = (id: string) => `http://127.0.0.1:${CONTROL_PORT}/fake/${id}?lane=${running()}`;

/** This lane's fake Roon Core: its port, and approving the extension as its owner would in Roon. */
export const fakeRoonPort = async () =>
  ((await (await fetch(`http://127.0.0.1:${CONTROL_PORT}/roon?lane=${running()}`)).json()) as { port: number }).port;
export const approveRoon = async () => {
  const r = await fetch(`http://127.0.0.1:${CONTROL_PORT}/roon/approve?lane=${running()}`, { method: "POST" });
  if (r.status !== 204) throw new Error(`approving Roon: ${r.status}`);
};

/** Where a screenshot goes, for a person to look at: the web in Chromium's in screenshots/, other lanes' in screenshots/<lane>/. */
export const shotPath = (name: string) =>
  fileURLToPath(new URL(`screenshots/${running() === "web" ? "" : `${running()}/`}${name}.png`, import.meta.url));
