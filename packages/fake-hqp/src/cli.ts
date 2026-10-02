// Run a fake HQPlayer:  npm run fake -- [--profile ID] [--port N] [--host ADDR]
//                                       [--time-scale X] [--discovery PORT]
//                                       [--source-rate HZ] [--ignore COMMAND]... [--quiet]
import { parseArgs } from "node:util";
import { FakeHqp } from "./fake.ts";
import { PROFILE_IDS, loadProfile } from "./profile.ts";

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "desktop5-mac-sdm" },
    port: { type: "string", default: "14321" },
    host: { type: "string", default: "127.0.0.1" },
    "time-scale": { type: "string", default: "1" },
    discovery: { type: "string" },
    "source-rate": { type: "string", default: "44100" },
    ignore: { type: "string", multiple: true, default: [] },
    quiet: { type: "boolean", default: false },
  },
});

// 4321 is the real HQPlayer port. A fake there could be mistaken for the real
// thing, or the other way round. Refuse.
if (values.port === "4321") {
  console.error("refusing to listen on 4321: that is the real HQPlayer port. Use the default 14321.");
  process.exit(2);
}
if (!(PROFILE_IDS as readonly string[]).includes(values.profile)) {
  console.error(`unknown profile ${values.profile}; choose one of: ${PROFILE_IDS.join(", ")}`);
  process.exit(2);
}

const fake = new FakeHqp(loadProfile(values.profile), {
  timeScale: Number(values["time-scale"]),
  log: values.quiet ? undefined : (l) => console.error(l),
});
fake.setSource(Number(values["source-rate"]));
for (const c of values.ignore) fake.ignore.add(c);
const addr = await fake.listen(Number(values.port), values.host);
console.error(`fake HQPlayer "${values.profile}" listening on ${addr.host}:${addr.port} (time scale ${values["time-scale"]})`);
if (values.discovery) {
  await fake.listenDiscovery(Number(values.discovery));
  console.error(`answering discovery on UDP ${values.discovery}`);
}

const stop = async () => {
  await fake.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
