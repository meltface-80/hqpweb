// The setup questions and the answers each allows, as the server stores them
// (apps/server/src/setup.ts; test/setup-answers.test.ts keeps the two in step).
import type { Setup } from "./api.ts";

export const SETUP_ANSWERS = {
  dsd: ["older-ess", "remodulates", "direct", "converts"],
  pcm: ["delta-sigma", "ladder"],
  amp: ["class-d-or-tube", "other", "unsure"],
  link: ["usb", "spdif", "i2s"],
  volume: ["hqplayer", "fixed"],
} as const satisfies { [K in keyof Required<Setup>]: readonly NonNullable<Setup[K]>[] };
