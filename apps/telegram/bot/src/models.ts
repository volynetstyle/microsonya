import {
  ModelGateway,
  OpenAiCompatibleClient,
} from "@microsonya/model-gateway";
import type { AppConfig } from "./config.js";
import { requiredConfigValue } from "./errors.js";

export function createModels(config: AppConfig): ModelGateway | undefined {
  if (config.disabledServices.has("llm")) {
    return undefined;
  }

  return new ModelGateway(
    new OpenAiCompatibleClient({
      baseUrl: requiredConfigValue(config.llmBaseUrl, "LLM_BASE_URL"),
      apiKey: requiredConfigValue(config.llmApiKey, "LLM_API_KEY"),
      model: requiredConfigValue(config.llmModel, "LLM_MODEL"),
      models: filterQuarantinedModels(
        config.llmModels,
        config.llmQuarantineModels,
      ),
    }),
  );
}

function filterQuarantinedModels(
  models: string[] | undefined,
  quarantine: string[] | undefined,
): string[] | undefined {
  if (!models || !quarantine?.length) {
    return models;
  }

  const blocked = new Set(quarantine);
  return models.filter((model) => !blocked.has(model));
}