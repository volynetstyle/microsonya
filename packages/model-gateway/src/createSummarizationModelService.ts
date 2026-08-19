import { AiSdkGenerator } from "./AiSdkGenerator.js";
import { createAiSdkModel } from "./createAiSdkModel.js";
import { DefaultModelClient } from "./DefaultModelClient.js";
import type { ModelConfig } from "./modelConfig.js";
import type { ModelCallTelemetry, ModelClient } from "./ModelClient.js";
import type { StructuredGenerator } from "./ModelGenerators.js";
import { OllamaStructuredGenerator } from "./OllamaStructuredGenerator.js";
import { SummarizationModelService } from "./SummarizationModelService.js";

export type CreateSummarizationModelServiceOptions = {
  appName?: string;
  referer?: string;
  fetch?: typeof globalThis.fetch;
  onTelemetry?: (event: ModelCallTelemetry) => void;
};

/** Builds the summary-path service from `config.models[0]` (and `config.mergeModel`, if set). */
export function createSummarizationModelService(
  config: ModelConfig,
  options: CreateSummarizationModelServiceOptions = {},
): SummarizationModelService | undefined {
  if (config.mode === "disabled") return undefined;

  const primaryModel = config.models?.[0];
  if (!primaryModel) {
    throw new Error("At least one model must be configured.");
  }

  return new SummarizationModelService(
    buildDefaultModelClient(config, primaryModel, config.mergeModel ?? primaryModel, options),
  );
}

/** Builds the memory-extraction service, always a single dedicated model. */
export function createMemorySummarizationModelService(
  config: ModelConfig,
  options: CreateSummarizationModelServiceOptions = {},
): SummarizationModelService | undefined {
  if (config.mode === "disabled") return undefined;

  return new SummarizationModelService(
    buildDefaultModelClient(config, config.memoryModel, config.memoryModel, options),
  );
}

function buildDefaultModelClient(
  config: ModelConfig,
  primaryModelId: string,
  textModelId: string,
  options: CreateSummarizationModelServiceOptions,
): ModelClient {
  const modelOptions = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    appName: options.appName,
    referer: options.referer,
    fetch: options.fetch,
  };

  const primaryModel = createAiSdkModel({ ...modelOptions, modelId: primaryModelId });
  const primaryGenerator = new AiSdkGenerator({
    model: primaryModel,
    modelId: primaryModelId,
    onTelemetry: options.onTelemetry,
  });

  const textGenerator =
    textModelId === primaryModelId
      ? primaryGenerator
      : new AiSdkGenerator({
          model: createAiSdkModel({ ...modelOptions, modelId: textModelId }),
          modelId: textModelId,
          onTelemetry: options.onTelemetry,
        });

  const structuredGenerator: StructuredGenerator =
    config.structuredOutputTransport === "ollama-native"
      ? new OllamaStructuredGenerator({
          baseUrl: config.baseUrl,
          model: primaryModelId,
          fetch: options.fetch,
          onTelemetry: options.onTelemetry,
        })
      : primaryGenerator;

  return new DefaultModelClient(textGenerator, structuredGenerator);
}
