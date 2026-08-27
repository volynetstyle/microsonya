import { describe, expect, it, vi } from "vitest";
import {
  CLASSIFIER_PROFILE,
  loadOllamaConfig,
  OllamaClient,
  withTelemetry,
} from "../packages/model/src/index.js";

describe("OllamaClient profiles", () => {
  it("keeps the provider endpoint in config and the model in the profile", () => {
    expect(
      loadOllamaConfig({
        OLLAMA_HOST: "https://ollama.example/api/",
        OLLAMA_API_KEY: "secret",
        OLLAMA_MODEL: "must-not-override-the-validated-profile",
      }),
    ).toEqual({
      baseUrl: "https://ollama.example/api",
      apiKey: "secret",
    });
    expect(CLASSIFIER_PROFILE.model).toBe("gpt-oss:120b-cloud");
    expect(CLASSIFIER_PROFILE.options).toMatchObject({
      temperature: 0,
      top_k: 1,
      num_predict: 512,
    });
  });

  it("sends a task profile directly through /api/chat", async () => {
    let requestInit: RequestInit | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      requestInit = init;
      return new Response(
        JSON.stringify({
          message: { content: JSON.stringify({ action: "SUMMARIZE" }) },
        }),
        { status: 200 },
      );
    });
    const ollama = new OllamaClient({
      baseUrl: "http://localhost:11434/api",
      fetch,
    });
    await expect(
      ollama.chat({
        ...CLASSIFIER_PROFILE,
        stream: false,
        messages: [{ role: "user", content: "prompt" }],
      }),
    ).resolves.toMatchObject({
      message: { content: JSON.stringify({ action: "SUMMARIZE" }) },
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
    const request = JSON.parse(String(requestInit?.body));
    expect(request).toMatchObject({
      ...CLASSIFIER_PROFILE,
      stream: false,
      messages: [{ role: "user", content: "prompt" }],
    });
  });

  it("instruments fetch without coupling telemetry to a model abstraction", async () => {
    const onCall = vi.fn();
    const instrumentedFetch = withTelemetry(
      async () => new Response("{}", { status: 200 }),
      onCall,
    );
    await instrumentedFetch("http://localhost");
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });
});
