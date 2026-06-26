import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FreeModelSwitch,
  OpenAiCompatibleClient,
} from "../packages/model-gateway/src/index.js";

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

  it("falls back to the next configured model after a retryable rate limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              metadata: {
                retry_after_seconds: 1,
              },
            },
          }),
          {
            status: 429,
            headers: { "Retry-After": "1" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAiCompatibleClient({
      baseUrl: "https://openrouter.ai/api/v1",
      models: ["first:free", "second:free"],
      maxRetries: 0,
    });

    await expect(client.complete("hello")).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      model: "first:free",
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      model: "second:free",
    });
    expect(client.getFreeModelSwitchSnapshot()[0]).toMatchObject({
      id: "first:free",
      fail: 1,
      fail429: 1,
    });
  });
});

describe("FreeModelSwitch", () => {
  it("uses neutral unknown success and clamps latency penalty", () => {
    const router = new FreeModelSwitch([
      {
        id: "slow-known",
        label: "Slow known",
        context: 0,
        kind: "summary",
        priority: 100,
      },
      {
        id: "unknown",
        label: "Unknown",
        context: 0,
        kind: "summary",
        priority: 100,
      },
    ]);

    router.reportSuccess("slow-known", 60_000);

    const snapshot = router.snapshot();
    const slowKnown = snapshot.find((item) => item.id === "slow-known");
    const unknown = snapshot.find((item) => item.id === "unknown");

    expect(slowKnown?.score).toBeGreaterThan(99);
    expect(unknown?.score).toBeCloseTo(106.5);
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
