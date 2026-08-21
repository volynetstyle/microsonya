import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OllamaModel, withTelemetry } from "../packages/model/src/index.js";

describe("OllamaModel", () => {
  it("generates and validates structured output through /api/chat", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: { content: JSON.stringify({ summary: "Готово" }) },
          }),
          { status: 200 },
        ),
    );
    const model = new OllamaModel({
      host: "http://localhost:11434/v1",
      model: "test",
      fetch,
    });

    await expect(
      model.generate("prompt", z.object({ summary: z.string() })),
    ).resolves.toEqual({ summary: "Готово" });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("adds telemetry without coupling it to the transport", async () => {
    const onCall = vi.fn();
    const model = withTelemetry(
      { generate: async () => ({ ok: true }) },
      onCall,
    );
    await model.generate("prompt", z.object({ ok: z.boolean() }));
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });
});
