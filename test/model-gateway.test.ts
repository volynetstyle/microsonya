import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiSdkModelClient } from "../packages/model-gateway/src/index.js";

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
