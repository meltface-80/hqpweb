// The five setup questions as the listener sees them: titles, help, and a label and
// description for each answer. Used by Settings ("Your setup") and the picker's guides.
// The answers themselves are SETUP_ANSWERS' (setup-answers.ts); an answer missing here,
// or one that isn't allowed, is a type error. Wording reviewed with the picker mockup
// (5 Oct 2026).
import { RULES, type Rule } from "./advice/policy.ts";
import { SETUP_ANSWERS } from "./setup-answers.ts";

export type SetupKey = keyof typeof SETUP_ANSWERS;
export type SetupAnswer<K extends SetupKey> = (typeof SETUP_ANSWERS)[K][number];

export interface SetupOption<V extends string = string> {
  value: V;
  label: string;
  description: string;
}

export interface SetupQuestion<K extends SetupKey = SetupKey> {
  key: K;
  /** Its heading in Settings, e.g. "Your amplifier". */
  title: string;
  /** The question asked plainly, as a guide asks it. */
  question: string;
  /** Why it matters. */
  help?: string;
  /** Signalyst's post behind the help, when it states their advice. */
  source?: Rule;
  /** What leaving it unanswered means. */
  notSet: string;
  /** In SETUP_ANSWERS' order. */
  options: SetupOption<SetupAnswer<K>>[];
}

type Labels<K extends SetupKey> = { [V in SetupAnswer<K>]: { label: string; description: string } };

function question<K extends SetupKey>(key: K, q: Omit<SetupQuestion<K>, "key" | "options">, labels: Labels<K>): SetupQuestion<K> {
  const values: readonly SetupAnswer<K>[] = SETUP_ANSWERS[key];
  return { key, ...q, options: values.map((value) => ({ value, ...labels[value] })) };
}

export const SETUP_QUESTIONS: { [K in SetupKey]: SetupQuestion<K> } = {
  dsd: question(
    "dsd",
    {
      title: "How your DAC takes DSD",
      question: "What does your DAC do with DSD?",
      help: "This sets the order and the rate.",
      notSet: "Modulator advice stays off until you choose.",
    },
    {
      "older-ess": {
        label: "An older ESS chip",
        description: "ES9018, ES9028, ES9038 (any version) or ES9068. Fifth order; DSD512 suits it.",
      },
      remodulates: {
        label: "A newer ESS chip, or another DAC that re-processes DSD",
        description: "ES9039 and later, the AK4191 pair, PS Audio. Seventh order; DSD512 for ESS.",
      },
      direct: {
        label: "DSD goes straight to the converter",
        description:
          "Burr-Brown/TI, ROHM, Holo and other discrete DSD, AKM in DSD Direct mode. Seventh order; DSD256, or DSD1024 with AHM.",
      },
      converts: {
        label: "It converts or filters DSD, or doesn't take it",
        description: "Chord, Denafrips, Weiss, Schiit multibit. PCM output suits it better.",
      },
    },
  ),
  pcm: question(
    "pcm",
    {
      title: "How your DAC converts PCM",
      question: "How does your DAC convert PCM?",
      help: "This decides whether noise shaping helps.",
      notSet: "Dither advice stays off until you choose.",
    },
    {
      "delta-sigma": {
        label: "Delta-sigma",
        description:
          "A converter chip from ESS, AKM, Burr-Brown or Cirrus, or a design that resamples everything, like Chord or dCS.",
      },
      ladder: {
        label: "Ladder (R2R) or multibit",
        description: 'A resistor-ladder design; makers say so prominently, often as "R2R".',
      },
    },
  ),
  amp: question(
    "amp",
    {
      title: "Your amplifier",
      question: "Is your power amplifier class-D or tube?",
      help: "Class-D and tube amplifiers cope less well with ultrasonic noise, so Signalyst suggests fifth order with them.",
      source: RULES.ampFifth,
      notSet: "",
    },
    {
      "class-d-or-tube": { label: "Yes", description: "Class-D or tube power amplifier." },
      other: { label: "No", description: "Any other kind." },
      unsure: { label: "Not sure", description: "Keeps HQPlayer's default." },
    },
  ),
  volume: question(
    "volume",
    {
      title: "Your volume",
      question: "Do you set the volume in HQPlayer?",
      help: "Signalyst suggests gain optimisation: HQPlayer at −3 dB, the amplifier at the loudest you'd ever want, then turn down in HQPlayer or Roon. That keeps you safe from too-loud accidents. Never above −3 dB.",
      source: RULES.gainOpt,
      notSet: "",
    },
    {
      hqplayer: {
        label: "Yes",
        description: "HQPlayer is my volume control (Roon's slider included), ideally with gain optimisation.",
      },
      fixed: { label: "No", description: "I keep HQPlayer at about −3 dB, or on its fixed volume." },
    },
  ),
  link: question(
    "link",
    {
      title: "How the DAC connects",
      question: "How does the signal reach your DAC?",
      help: "USB is best where the DAC has it. S/PDIF and AES carry 24 bits and top out around 192 kHz; I2S is rarely worth it over USB.",
      notSet: "Used for dither advice.",
    },
    {
      usb: { label: "USB or network", description: "Into the DAC's USB input, or over the network to an NAA." },
      spdif: { label: "S/PDIF, AES or optical", description: "Including a USB-to-S/PDIF bridge." },
      i2s: { label: "I2S", description: "Over HDMI-style or RJ45 I2S links." },
    },
  ),
};

/** The questions in Settings' order. */
export const SETUP_QUESTION_LIST: SetupQuestion[] = [
  SETUP_QUESTIONS.dsd,
  SETUP_QUESTIONS.pcm,
  SETUP_QUESTIONS.amp,
  SETUP_QUESTIONS.volume,
  SETUP_QUESTIONS.link,
];

/** What Settings says after saving an answer. `savedNow`: a discovered instance was saved first. */
export const savedMessage = (savedNow: boolean): string =>
  savedNow ? "Saved, and this instance is now saved in Settings." : "Saved.";
