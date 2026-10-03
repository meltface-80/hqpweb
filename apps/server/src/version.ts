// The app's version, from the root package.json (also copied into the image).
import pkg from "../../../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
