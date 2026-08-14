import {
  AiSdkModelClient,
  ModelGateway,
  ProductionModelRouterClient,
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
    }),
  );
}
