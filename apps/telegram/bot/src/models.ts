import {
  createMemorySummarizationModelService,
  createSummarizationModelService,
  type ModelCallTelemetry,
} from "@microsonya/model-gateway";
import type { AppConfig } from "./config.js";

export function createModels(config: AppConfig) {
  return createSummarizationModelService(config.llm, {
    appName: "Microsonya",
    onTelemetry: logModelTelemetry,
  });
}

export function createMemoryModels(config: AppConfig) {
  return createMemorySummarizationModelService(config.llm, {
    appName: "Microsonya",
    onTelemetry: logModelTelemetry,
  });
}

function logModelTelemetry(event: ModelCallTelemetry): void {
  console.info("Model call telemetry", JSON.stringify(event));
}
