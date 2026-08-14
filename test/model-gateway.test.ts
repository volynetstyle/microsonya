import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AiSdkModelClient,
  ProductionModelRouterClient,
  type ModelClient,
} from "../packages/model-gateway/src/index.js";

describe("AiSdkModelClient", () => {
  it("uses the OpenAI-compatible /v1 chat completions endpoint for bare base URLs", async () => {
    const fetchMock = mockFetch();
    const client = new AiSdkModelClient({
      baseUrl: "http://localhost:11434",
      models: ["qwen2.5:7b"],
      maxRetries: 0,
      fetch: fetchMock,
    });

    await client.generateText("hello");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });

  it("does not duplicate /v1 and keeps compatible-provider headers", async () => {
    const fetchMock = mockFetch();
    const client = new AiSdkModelClient({
      baseUrl: "https://models.example.test/api/v1",
      apiKey: "token",
      models: ["model"],
      appName: "Microsonya",
      referer: "https://example.test",
      maxRetries: 0,
      fetch: fetchMock,
    });

    await client.generateText("hello");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://models.example.test/api/v1/chat/completions",
    );
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("HTTP-Referer")).toBe("https://example.test");
    expect(headers.get("X-Title")).toBe("Microsonya");
  });

  it("delegates model fallback and structured-output healing to OpenRouter", async () => {
    const fetchMock = mockFetch({
      choices: [
        {
          message: {
            role: "assistant",
            content: '{"title":"Chat"}',
          },
          finish_reason: "stop",
        },
      ],
    });
    const client = new AiSdkModelClient({
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "token",
      models: ["first:free", "second:free", "third:free"],
      maxRetries: 0,
      fetch: fetchMock,
    });

    await expect(
      client.generateObject("hello", z.object({ title: z.string() })),
    ).resolves.toEqual({ title: "Chat" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      model: "first:free",
      models: ["second:free", "third:free"],
      plugins: [{ id: "response-healing" }],
      provider: {
        require_parameters: true,
      },
      response_format: {
        type: "json_schema",
      },
      temperature: 0.1,
      max_tokens: 1000,
    });
  });

  it("uses a separate lightweight OpenRouter model for text merges", async () => {
    const fetchMock = mockFetch();
    const client = new AiSdkModelClient({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "token",
      models: ["segment-primary", "segment-fallback"],
      mergeModel: "openrouter/free",
      fetch: fetchMock,
    });

    await expect(client.generateText("merge")).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body).toMatchObject({
      model: "openrouter/free",
      temperature: 0.1,
      max_tokens: 1000,
    });
    expect(body).not.toHaveProperty("models");
    expect(body).not.toHaveProperty("plugins");
  });
});

describe("ProductionModelRouterClient", () => {
  it("selects tiers by estimated input size", async () => {
    const clients = [
      mockClient("cheap"),
      mockClient("default"),
      mockClient("quality"),
    ];
    const router = createRouter(clients);

    await expect(router.generateText("short")).resolves.toBe("cheap");
    await expect(router.generateText("x".repeat(15))).resolves.toBe("default");
    await expect(router.generateText("x".repeat(25))).resolves.toBe("quality");
  });

  it("escalates to stronger tiers and then degrades when a route fails", async () => {
    const cheap = mockClient("cheap", new Error("cheap unavailable"));
    const standard = mockClient("default", new Error("default unavailable"));
    const quality = mockClient("quality");
    const router = createRouter([cheap, standard, quality]);

    await expect(router.generateText("short")).resolves.toBe("quality");
    expect(cheap.generateText).toHaveBeenCalledTimes(1);
    expect(standard.generateText).toHaveBeenCalledTimes(1);
    expect(quality.generateText).toHaveBeenCalledTimes(1);
  });

  it("opens a failing circuit and skips it until cooldown", async () => {
    let now = 100;
    const cheap = mockClient("cheap", new Error("down"));
    const standard = mockClient("default");
    const quality = mockClient("quality");
    const router = createRouter([cheap, standard, quality], {
      failureThreshold: 1,
      circuitCooldownMs: 1_000,
      now: () => now,
    });

    await router.generateText("short");
    await router.generateText("short");
    expect(cheap.generateText).toHaveBeenCalledTimes(1);

    now = 1_101;
    await router.generateText("short");
    expect(cheap.generateText).toHaveBeenCalledTimes(2);
  });
});

function createRouter(
  clients: ModelClient[],
  options: Partial<
    ConstructorParameters<typeof ProductionModelRouterClient>[0]
  > = {},
) {
  return new ProductionModelRouterClient({
    routes: (["cheap", "default", "quality"] as const).map((tier, index) => ({
      tier,
      model: tier,
      client: clients[index]!,
    })),
    defaultMinInputTokens: 10,
    qualityMinInputTokens: 20,
    estimateInputTokens: (prompt) => prompt.length,
    ...options,
  });
}

function mockClient(value: string, error?: Error): ModelClient {
  return {
    generateText: vi.fn(async () => {
      if (error) throw error;
      return value;
    }),
    generateObject: vi.fn(async (_prompt, schema) => schema.parse({ value })),
  };
}

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
