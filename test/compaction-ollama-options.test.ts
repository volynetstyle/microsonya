import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { runOllama } from "../experimental/eval/src/ollama.js";

describe("compaction classifier generation options", () => {
  it("forwards the greedy preset and disables thinking", async () => {
    let received: Record<string, unknown> | undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: { content: "{}" } }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Test server did not bind");
    try {
      await runOllama({
        model: "classifier",
        prompt: "x",
        reasoning: "low",
        think: false,
        seed: 42,
        baseUrl: `http://127.0.0.1:${address.port}`,
        generationOptions: {
          temperature: 0,
          topK: 1,
          topP: 1,
          minP: 0,
          numPredict: 16,
          repeatPenalty: 1,
          presencePenalty: 0,
          frequencyPenalty: 0,
          stop: ["\n"],
        },
      });
      expect(received).toMatchObject({
        think: false,
        options: {
          seed: 42,
          temperature: 0,
          top_k: 1,
          top_p: 1,
          min_p: 0,
          num_predict: 16,
          repeat_penalty: 1,
          presence_penalty: 0,
          frequency_penalty: 0,
          stop: ["\n"],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
