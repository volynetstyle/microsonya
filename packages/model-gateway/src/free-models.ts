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
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    label: "NVIDIA Nemotron 3 Nano 30B A3B",
    context: 262_144,
    kind: "summary",
    priority: 100,
  },
  {
    id: "openai/gpt-oss-20b:free",
    label: "OpenAI GPT-OSS 20B",
    context: 131_072,
    kind: "summary",
    priority: 95,
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Google Gemma 4 31B",
    context: 262_144,
    kind: "summary",
    priority: 90,
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Google Gemma 4 26B A4B",
    context: 262_144,
    kind: "summary",
    priority: 85,
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct:free",
    label: "Qwen3 Next 80B A3B Instruct",
    context: 262_144,
    kind: "summary",
    priority: 75,
  },
  {
    id: "openai/gpt-oss-120b:free",
    label: "OpenAI GPT-OSS 120B",
    context: 131_072,
    kind: "long",
    priority: 70,
  },
  {
    id: "openrouter/free",
    label: "OpenRouter Free Router",
    context: 200_000,
    kind: "fallback",
    priority: 1,
  },
];

export const SAFETY_MODEL = {
  id: "nvidia/nemotron-3.5-content-safety:free",
  label: "NVIDIA Nemotron 3.5 Content Safety",
  context: 128_000,
};
