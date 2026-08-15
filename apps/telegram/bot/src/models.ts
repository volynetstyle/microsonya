import {
  AiSdkModelClient,
  ModelGateway,
  ProductionModelRouterClient,
  type ModelCallTelemetry,
  type ProductionModelTier,
} from "@microsonya/model-gateway";
import type { AppConfig } from "./config.js";

export function createModels(config: AppConfig): ModelGateway | undefined {
  if (config.modelsMode === "disabled") {
    return undefined;
  }

  const createClient = (model: string) =>
    new AiSdkModelClient({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      models: [model],
      mergeModel: model,
      appName: "Microsonya",
      onTelemetry: logModelTelemetry,
    });

  if (config.llm.router) {
    const router = config.llm.router;
    const models: Array<[ProductionModelTier, string]> = [
      ["cheap", router.cheapModel],
      ["default", router.defaultModel],
      ["quality", router.qualityModel],
    ];
    return new ModelGateway(
      new ProductionModelRouterClient({
        routes: models.map(([tier, model]) => ({
          tier,
          model,
          client: createClient(model),
        })),
        defaultMinInputTokens: router.defaultMinInputTokens,
        qualityMinInputTokens: router.qualityMinInputTokens,
        failureThreshold: router.failureThreshold,
        circuitCooldownMs: router.circuitCooldownMs,
        onEvent: (event) => {
          const details = {
            event: event.type,
            tier: event.tier,
            model: event.model,
            estimatedInputTokens: event.estimatedInputTokens,
            ...(event.error instanceof Error
              ? { error: event.error.message }
              : {}),
          };
          if (event.type === "failed" || event.type === "circuit-opened") {
            console.warn("Model router event", details);
          } else {
            console.info("Model router event", details);
          }
        },
      }),
    );
  }

  return new ModelGateway(
    new AiSdkModelClient({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      models: config.llm.models ?? [],
      mergeModel: config.llm.mergeModel,
      appName: "Microsonya",
      onTelemetry: logModelTelemetry,
    }),
  );
}

export function createMemoryModels(
  config: AppConfig,
): ModelGateway | undefined {
  if (config.modelsMode === "disabled") return undefined;
  return new ModelGateway(
    new AiSdkModelClient({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      models: [config.llm.memoryModel],
      mergeModel: config.llm.memoryModel,
      appName: "Microsonya",
      onTelemetry: logModelTelemetry,
    }),
  );
}

function logModelTelemetry(event: ModelCallTelemetry): void {
  console.info("Model call telemetry", JSON.stringify(event));
}
