import { SUMMARIZER_PROFILE, type OllamaClient } from "@microsonya/model";
import type { ConversationWindow, Summary } from "@microsonya/shared";
import { outputSchema, SUMMARY_INSTRUCTIONS } from "./constants.js";
import { buildModelPrompt } from "./prompt.js";
import type { ModelWindowMessageRole } from "./prompt.js";
import { parseModelOutput } from "./modelOutput.js";
import type { SummarizationTelemetryTrace } from "./telemetry.js";

export interface ConversationSummarizer {
  summarize(
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): Promise<Summary>;
  stream?(
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): AsyncIterable<string>;
}

export interface ConversationSummarizerDeps {
  readonly ollama: Pick<OllamaClient, "chat">;
}

export function createConversationSummarizer({
  ollama,
}: ConversationSummarizerDeps): ConversationSummarizer {
  const stream = async function* (
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): AsyncIterable<string> {
    signal?.throwIfAborted();
    const prompt = `${buildSummaryPrompt(window, roles)}\n\nReturn only the summary as plain text. Do not use JSON or Markdown.`;
    telemetry?.record({
      type: "model.request",
      stage: "summarizer",
      model: SUMMARIZER_PROFILE.model,
      messageCount: window.messages.length,
      promptChars: prompt.length,
      prompt,
    });
    const startedAt = performance.now();
    let content = "";
    for await (const event of ollama.chat(
      {
        ...SUMMARIZER_PROFILE,
        format: undefined,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      },
      { signal },
    )) {
      signal?.throwIfAborted();
      const delta = event.message.content;
      if (delta.length > 0) {
        content += delta;
        yield delta;
      }
    }
    const durationMs = performance.now() - startedAt;
    if (content.trim().length === 0) {
      throw new TypeError("Streaming summarizer returned empty output.");
    }
    telemetry?.record({
      type: "model.response",
      stage: "summarizer",
      model: SUMMARIZER_PROFILE.model,
      attempt: 1,
      durationMs,
      responseChars: content.length,
      summaryChars: content.length,
    });
  };

  return {
    stream,
    summarize: async (window, signal, telemetry, roles) => {
      signal?.throwIfAborted();
      const prompt = buildSummaryPrompt(window, roles);
      telemetry?.record({
        type: "model.request",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        messageCount: window.messages.length,
        promptChars: prompt.length,
        prompt,
      });
      const startedAt = performance.now();
      const response = await ollama.chat(
        {
          ...SUMMARIZER_PROFILE,
          stream: false,
          messages: [{ role: "user", content: prompt }],
        },
        { signal },
      );
      signal?.throwIfAborted();

      const durationMs = performance.now() - startedAt;
      telemetry?.record({
        type: "model.response.envelope",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        durationMs,
        done: response.done,
        doneReason: response.done_reason,
        promptEvalCount: response.prompt_eval_count,
        evalCount: response.eval_count,
        contentChars: response.message.content.length,
        thinkingChars: response.message.thinking?.length ?? 0,
        content: response.message.content,
        thinking: response.message.thinking,
      });
      const { summary } = parseModelOutput({
        raw: response.message.content,
        schema: outputSchema,
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        durationMs,
        attempt: 1,
        telemetry,
      });
      telemetry?.record({
        type: "model.response",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        durationMs,
        responseChars: response.message.content.length,
        summaryChars: summary.length,
      });
      return Object.freeze({ text: summary });
    },
  };
}

export function buildSummaryPrompt(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): string {
  return buildModelPrompt(
    "SUMMARY_POLICY",
    SUMMARY_INSTRUCTIONS,
    window,
    roles,
  );
}
