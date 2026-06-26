import {
  OpenAiCompatibleClient,
  type OpenAiCompatibleOptions,
} from "./openai-compatible.js";

export type OllamaOptions = Omit<OpenAiCompatibleOptions, "baseUrl"> & {
  baseUrl?: string;
};

export class OllamaClient extends OpenAiCompatibleClient {
  constructor(options: OllamaOptions) {
    super({
      baseUrl: options.baseUrl ?? "http://localhost:11434",
      apiKey: options.apiKey,
      model: options.model,
    });
  }
}
