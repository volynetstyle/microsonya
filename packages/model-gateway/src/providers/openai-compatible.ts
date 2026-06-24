import type { ModelClient, ModelResponseFormat } from "../ModelClient.js";

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey?: string;
  model: string;
};

export class OpenAiCompatibleClient implements ModelClient {
  constructor(private readonly options: OpenAiCompatibleOptions) {}

  async complete(prompt: string, responseFormat: ModelResponseFormat = "text"): Promise<string> {
    const response = await fetch(new URL("/v1/chat/completions", this.options.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        ...(responseFormat === "json" ? { response_format: { type: "json_object" } } : {})
      })
    });

    if (!response.ok) {
      throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Model response did not contain message content.");
    }

    return content;
  }
}
