import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AiSdkGenerator,
  createAiSdkModel,
  createSummarizationModelService,
  loadModelConfig,
  OllamaStructuredGenerator,
} from "../packages/model-gateway/src/index.js";

describe("AiSdkGenerator", () => {
  it("uses the OpenAI-compatible /v1 chat completions endpoint for bare base URLs", async () => {
    const fetchMock = mockFetch();
    const generator = new AiSdkGenerator({
      model: createAiSdkModel({
        baseUrl: "http://localhost:11434",
        modelId: "qwen2.5:7b",
        fetch: fetchMock,
      }),
      modelId: "qwen2.5:7b",
      maxRetries: 0,
    });

    await generator.generateText("hello");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });

  it("does not duplicate /v1 and keeps compatible-provider headers", async () => {
    const fetchMock = mockFetch();
    const generator = new AiSdkGenerator({
      model: createAiSdkModel({
        baseUrl: "https://models.example.test/api/v1",
        apiKey: "token",
        modelId: "model",
        appName: "Microsonya",
        referer: "https://example.test",
        fetch: fetchMock,
      }),
      modelId: "model",
      maxRetries: 0,
    });

    await generator.generateText("hello");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://models.example.test/api/v1/chat/completions",
    );
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("HTTP-Referer")).toBe("https://example.test");
    expect(headers.get("X-Title")).toBe("Microsonya");
  });

  it("generates schema-constrained objects", async () => {
    const fetchMock = mockFetch({
      choices: [
        {
          message: { role: "assistant", content: '{"title":"Chat"}' },
          finish_reason: "stop",
        },
      ],
    });
    const generator = new AiSdkGenerator({
      model: createAiSdkModel({
        baseUrl: "https://models.example.test/api/v1",
        apiKey: "token",
        modelId: "first-model",
        fetch: fetchMock,
      }),
      modelId: "first-model",
      maxRetries: 0,
    });

    await expect(
      generator.generateObject("hello", z.object({ title: z.string() })),
    ).resolves.toEqual({ title: "Chat" });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      model: "first-model",
      response_format: { type: "json_schema" },
      temperature: 0.1,
      max_tokens: 2500,
    });
  });
});

describe("OllamaStructuredGenerator", () => {
  it("uses Ollama native JSON mode and normalizes usage", async () => {
    const onTelemetry = vi.fn();
    const fetchMock = mockFetch({
      message: {
        role: "assistant",
        content: '{"title":"Chat"}',
        thinking: "Check the schema.",
      },
      prompt_eval_count: 80,
      eval_count: 50,
      total_duration: 2_000_000_000,
      load_duration: 100_000_000,
      prompt_eval_duration: 400_000_000,
      eval_duration: 1_000_000_000,
      done_reason: "stop",
    });
    const generator = new OllamaStructuredGenerator({
      baseUrl: "http://localhost:11434",
      model: "gpt-oss:120b-cloud",
      fetch: fetchMock,
      onTelemetry,
    });

    await expect(
      generator.generateObject("hello", z.object({ title: z.string() }), {
        operation: "segment-summary",
        chatId: "chat",
        commandMessageId: 7,
        segmentId: "segment",
        maxOutputTokens: 4_672,
      }),
    ).resolves.toEqual({ title: "Chat" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:11434/api/chat",
    );
    expect(body).toMatchObject({
      model: "gpt-oss:120b-cloud",
      stream: false,
      think: "low",
      format: "json",
      options: {
        temperature: 0.1,
        num_ctx: 32_768,
        num_predict: 2_500,
      },
    });
    expect(onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "segment-summary",
        chatId: "chat",
        commandMessageId: 7,
        segmentId: "segment",
        model: "gpt-oss:120b-cloud",
        status: "ok",
        usage: expect.objectContaining({
          inputTokens: 80,
          generatedTokens: 50,
          outputTokens: expect.any(Number),
          reasoningTokens: expect.any(Number),
          ollamaTotalMs: 2000,
          loadMs: 100,
          promptEvalMs: 400,
          evalMs: 1000,
          doneReason: "stop",
        }),
      }),
    );
  });

  it("propagates user cancellation to the active request", async () => {
    const onTelemetry = vi.fn();
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const generator = new OllamaStructuredGenerator({
      baseUrl: "http://localhost:11434",
      model: "gpt-oss:120b-cloud",
      fetch: fetchMock,
      onTelemetry,
    });
    const controller = new AbortController();
    const request = generator.generateObject(
      "hello",
      z.object({ title: z.string() }),
      { operation: "segment-summary", chatId: "chat", commandMessageId: 7 },
      controller.signal,
    );

    controller.abort(new DOMException("Cancelled", "AbortError"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "Cancelled" }),
    );
  });

  it("defaults the call context so an unqualified call does not crash", async () => {
    const fetchMock = mockFetch({
      message: { role: "assistant", content: "{}" },
    });
    const generator = new OllamaStructuredGenerator({
      baseUrl: "http://localhost:11434",
      model: "model",
      fetch: fetchMock,
    });

    await expect(
      generator.generateObject("hello", z.object({})),
    ).resolves.toEqual({});
  });

  it("strips a /v1 suffix since Ollama's native API is always at the origin", async () => {
    const fetchMock = mockFetch({
      message: { role: "assistant", content: "{}" },
    });
    const generator = new OllamaStructuredGenerator({
      baseUrl: "http://localhost:11434/v1",
      model: "model",
      fetch: fetchMock,
    });

    await generator.generateObject("hello", z.object({}));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:11434/api/chat",
    );
  });
});

describe("createSummarizationModelService", () => {
  it("routes structured generation by the configured transport, not a base-url heuristic", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      if (String(input).endsWith("/api/chat")) {
        return new Response(
          JSON.stringify({ message: { role: "assistant", content: "{}" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "{}" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const ollamaConfig = loadModelConfig({
      MODELS_MODE: "enabled",
      LLM_BASE_URL: "http://localhost:11434",
      LLM_MODEL: "gpt-oss:120b-cloud",
    } as NodeJS.ProcessEnv);
    const ollamaService = createSummarizationModelService(ollamaConfig, {
      fetch: fetchMock,
    })!;
    await ollamaService.extractMemoryOps("prompt");
    expect(requestedUrls.at(-1)).toBe("http://localhost:11434/api/chat");

    requestedUrls.length = 0;
    const compatibleConfig = loadModelConfig({
      MODELS_MODE: "enabled",
      LLM_BASE_URL: "https://models.example.test",
      LLM_MODEL: "model",
      LLM_API_KEY: "token",
      LLM_STRUCTURED_TRANSPORT: "openai-compatible",
    } as NodeJS.ProcessEnv);
    const compatibleService = createSummarizationModelService(
      compatibleConfig,
      {
        fetch: fetchMock,
      },
    )!;
    await compatibleService.extractMemoryOps("prompt");
    expect(requestedUrls.at(-1)).toBe(
      "https://models.example.test/v1/chat/completions",
    );
  });
});

function mockFetch(
  body: unknown = {
    choices: [
      {
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
  },
) {
  return vi.fn(async () => {
    return new Response(
      JSON.stringify({
        id: "completion-id",
        created: 1,
        model: "test-model",
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
        ...body,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });
}
