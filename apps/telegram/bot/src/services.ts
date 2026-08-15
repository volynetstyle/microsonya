import type { AppConfig } from "./config.js";
import type { ModelGateway } from "@microsonya/model-gateway";
import { createMemoryModels, createModels } from "./models.js";
import { createStorage, type Storage } from "./storage.js";

export type AppServices = {
  storage: Storage;
  models?: ModelGateway;
  memoryModels?: ModelGateway;
};

export function createServices(config: AppConfig): AppServices {
  return {
    storage: createStorage(config),
    models: createModels(config),
    memoryModels: createMemoryModels(config),
  };
}
