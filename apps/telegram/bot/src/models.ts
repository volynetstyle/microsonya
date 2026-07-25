import { AiSdkModelClient, ModelGateway } from "@microsonya/model-gateway";
import type { AppConfig } from "./config.js";

export function createModels(config: AppConfig): ModelGateway | undefined {
  if (config.modelsMode === "disabled") {
    return undefined;
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
