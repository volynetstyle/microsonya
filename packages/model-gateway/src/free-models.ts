export type FreeModelKind = "summary" | "code" | "long" | "safety" | "fallback";

export type FreeModelProfile = {
  id: string;
  label: string;
  context: number;
  kind: FreeModelKind;
  priority: number;
};

export const FREE_SUMMARY_MODELS: FreeModelProfile[] = [
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "NVIDIA Nemotron 3 Super 120B A12B",
    context: 1_000_000,
    kind: "summary",
    priority: 100,
  },
  {
    id: "openai/gpt-oss-20b:free",
    label: "OpenAI GPT-OSS 20B",
    context: 131_072,
    kind: "summary",
    priority: 90,
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Google Gemma 4 26B A4B",
    context: 262_144,
    kind: "summary",
    priority: 80,
  },
  {
    id: "nvidia/nemotron-nano-9b-v2:free",
    label: "NVIDIA Nemotron Nano 9B v2",
    context: 32_000,
    kind: "summary",
    priority: 70,
  },
  {
    id: "openrouter/free",
    label: "OpenRouter Free Models Router",
    context: 0,
    kind: "fallback",
    priority: 1,
  },
];

export const DEFAULT_MERGE_MODEL = "openrouter/free";

export const SAFETY_MODEL = {
  id: "nvidia/nemotron-3.5-content-safety:free",
  label: "NVIDIA Nemotron 3.5 Content Safety",
  context: 128_000,
};
