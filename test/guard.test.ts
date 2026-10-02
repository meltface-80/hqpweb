import { expect, it } from "vitest";
import { HqpClient } from "@app/protocol";

it("refuses to connect to port 4321 during tests", async () => {
  await expect(new HqpClient("127.0.0.1", { port: 4321, timeoutMs: 500 }).info()).rejects.toThrow(/never connect to port 4321/);
});
