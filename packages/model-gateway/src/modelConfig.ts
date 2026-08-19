/**
 * Single source of truth for model configuration. Every app in this repo
 * should read its model settings through {@link loadModelConfig} instead of
 * parsing LLM_* env vars itself, so there is exactly one place that knows
 * the env var names and defaults.
 *
 * Default transport is a local native Ollama server at
 * `http://localhost:11434` with `structuredOutputTransport: "ollama-native"`.
 * That pairing is a default, not an inference: which structured-output
 * transport to use is controlled explicitly by LLM_STRUCTURED_TRANSPORT
 * (behavior), never sniffed from the base URL (a brand/port heuristic that
 * breaks behind a proxy or a renamed port). Point LLM_BASE_URL at OpenRouter
 * or any OpenAI-compatible endpoint and set LLM_STRUCTURED_TRANSPORT=openai-compatible
 * to switch providers.
 */
export type ModelsMode = "enabled" | "disabled";

/**
 * How structured (schema-constrained) generation talks to the endpoint.
 * "ollama-native" uses Ollama's own /api/chat JSON mode, which is more
 * reliable than its OpenAI-compatible json_schema translation.
 */
export type StructuredOutputTransport = "openai-compatible" | "ollama-native";

export type ModelConfig = {
  mode: ModelsMode;
  baseUrl: string;
  apiKey?: string;
  structuredOutputTransport: StructuredOutputTransport;

  /** Models available for use after excluding quarantined models. */
  models?: string[];
  mergeModel?: string;
  memoryModel: string;

  /** Models explicitly forbidden from use. */
  quarantineModels?: string[];
};

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_STRUCTURED_OUTPUT_TRANSPORT: StructuredOutputTransport = "ollama-native";
const DEFAULT_MODEL = "gpt-oss:120b-cloud";
const DEFAULT_MEMORY_MODEL = "gpt-oss:20b-cloud";

export function loadModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  const mode = parseModelsMode(env.MODELS_MODE);
  const baseUrl = env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const apiKey =
    env.LLM_API_KEY?.trim() || env.OPENROUTER_TOKEN?.trim() || undefined;
  const structuredOutputTransport = parseStructuredOutputTransport(
    env.LLM_STRUCTURED_TRANSPORT,
  );

  const configuredModels = parseList(
    env.LLM_MODELS ?? env.LLM_MODEL ?? DEFAULT_MODEL,
  );
  const quarantineModels = parseList(env.LLM_QUARANTINE_MODELS);
  const models = excludeValues(configuredModels, quarantineModels);

  if (mode === "enabled") {
    if (!models?.length) {
      throw new Error(
        "At least one usable model is required when MODELS_MODE is enabled. Configure LLM_MODELS or LLM_MODEL and ensure not all models are quarantined.",
      );
    }

    if (!apiKey && !isLoopbackUrl(baseUrl)) {
      throw new Error(
        "LLM_API_KEY or OPENROUTER_TOKEN is required when MODELS_MODE is enabled and LLM_BASE_URL does not point at a local endpoint.",
      );
    }
  }

  return {
    mode,
    baseUrl,
    apiKey,
    structuredOutputTransport,
    models,
    mergeModel: env.LLM_MERGE_MODEL?.trim() || undefined,
    memoryModel: env.LLM_MEMORY_MODEL?.trim() || DEFAULT_MEMORY_MODEL,
    quarantineModels,
  };
}

function parseModelsMode(value: string | undefined): ModelsMode {
  switch (normalizeMode(value ?? "enabled")) {
    case "openai-compatible":
    case "openai":
    case "openrouter":
    case "ollama":
    case "llm":
    case "enabled":
      return "enabled";

    case "disabled":
    case "none":
    case "off":
      return "disabled";

    default:
      throw new Error(
        `Unknown MODELS_MODE "${value}". Supported values: enabled, disabled.`,
      );
  }
}

function parseStructuredOutputTransport(
  value: string | undefined,
): StructuredOutputTransport {
  switch (normalizeMode(value ?? DEFAULT_STRUCTURED_OUTPUT_TRANSPORT)) {
    case "ollama-native":
    case "ollama":
      return "ollama-native";

    case "openai-compatible":
    case "openai":
    case "compatible":
      return "openai-compatible";

    default:
      throw new Error(
        `Unknown LLM_STRUCTURED_TRANSPORT "${value}". Supported values: ollama-native, openai-compatible.`,
      );
  }
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

function normalizeMode(value: string): string {
  return value.trim().toLowerCase();
}

function excludeValues(
  values: string[] | undefined,
  excluded: string[] | undefined,
): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }

  if (!excluded?.length) {
    return values;
  }

  const excludedSet = new Set(excluded);
  const result = values.filter((value) => !excludedSet.has(value));

  return result.length > 0 ? result : undefined;
}

function parseList(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!items?.length) {
    return undefined;
  }

  return [...new Set(items)];
}
