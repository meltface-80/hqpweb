// The guide as a flow (docs/design-v2-layout.md, "Guide me"; canvas D2): the same steps
// as ModulatorGuide and DitherGuide, one at a time, with Back and Next. The steps, their
// titles and the decisions are the guides' own; this only orders them and says when Next
// is open (a question answered). Where to start is always the last step.
import type { Setup } from "./api.ts";
import type { SetupKey } from "./setup-questions.ts";

export interface FlowStep {
  /** The setup answer this step asks for; null for where to start. */
  key: SetupKey | null;
  title: string;
}

const MODULATOR: FlowStep[] = [
  { key: "dsd", title: "Your DAC" },
  { key: "amp", title: "Your amplifier" },
  { key: "volume", title: "Your volume" },
  { key: null, title: "Where to start" },
];
const DITHER: FlowStep[] = [
  { key: "pcm", title: "Your DAC" },
  { key: "link", title: "The connection" },
  { key: null, title: "Where to start" },
];

export const flowSteps = (isSdm: boolean): FlowStep[] => (isSdm ? MODULATOR : DITHER);

/** Next opens once the step's question has an answer; where to start has none to give. */
export function canGoOn(steps: FlowStep[], step: number, answers: Setup): boolean {
  const s = steps[step - 1];
  if (!s) return false;
  return s.key === null || answers[s.key] !== undefined;
}

/** The first step still to answer, so a returning user lands where they left off. */
export function firstOpen(steps: FlowStep[], answers: Setup): number {
  const i = steps.findIndex((s) => s.key !== null && answers[s.key] === undefined);
  return i < 0 ? steps.length : i + 1;
}
