// The app's version, from the root package.json (also copied into the image).
import pkg from "../../../package.json" with { type: "json" };

import { buildCommit } from "./commit.ts";

export const VERSION: string = pkg.version;
/** Short git commit of this build ("" if unknown). */
export const COMMIT: string = buildCommit(new URL("../../../", import.meta.url).pathname);
