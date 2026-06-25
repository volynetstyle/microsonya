import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleClient } from "../packages/model-gateway/src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAiCompatibleClient", () => {
  it("uses the OpenAI-compatible /v1 chat completions endpoint for bare base URLs", async () => {
    const fetchMock = mockFetch();
    const client = new OpenAiCompatibleClient({
      baseUrl: "http://localhost:11434",
      model: "qwen2.5:7b",
      maxRetries: 0,
    });

    await client.complete("hello");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });

  it("does not duplicate /v1 when the base URL already includes it", async () => {
    const fetchMock = mockFetch();
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "token",
      model: "openai/gpt-4o-mini",
      appName: "Microsonya",
      referer: "https://example.test",
      maxRetries: 0,
    });

    await client.complete("hello", "json");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(init?.headers).toMatchObject({
      authorization: "Bearer token",
      "HTTP-Referer": "https://example.test",
      "X-Title": "Microsonya",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      response_format: { type: "json_object" },
    });
  });
});

function mockFetch() {
  const fetchMock = vi.fn(async () => {
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}
