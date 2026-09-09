import type { OllamaClient } from "@microsonya/model";
import { SUMMARIZER_PROFILE } from "@microsonya/model";
import type { ConversationWindow, Summary } from "@microsonya/shared";
import type { SummaryExecutionRecorder } from "../execution/observer.js";
import { parseModelOutput } from "../model/output.js";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import { recordModelResponse } from "../model/response.js";
import { buildSummaryMessages } from "./prompt.js";
import { SUMMARY_RESPONSE_SCHEMA, summaryOutputSchema } from "./schema.js";
import { streamSummary } from "./stream.js";
import { validateSemanticOutput } from "./validation.js";

export interface ConversationSummarizer {
  summarize(
    window: ConversationWindow,
    signal?: AbortSignal,
    execution?: SummaryExecutionRecorder,
    roles?: readonly ModelWindowMessageRole[],
  ): Promise<Summary>;
  stream?(
    window: ConversationWindow,
    signal?: AbortSignal,
    execution?: SummaryExecutionRecorder,
    roles?: readonly ModelWindowMessageRole[],
  ): AsyncIterable<string>;
}

export interface ConversationSummarizerDependencies {
  readonly ollama: Pick<OllamaClient, "chat">;
  readonly currentDate?: string;
  readonly structuredOutput?: "schema" | "json";
}

export function createConversationSummarizer({
  ollama,
  currentDate,
  structuredOutput = "schema",
}: ConversationSummarizerDependencies): ConversationSummarizer {
  return {
    stream: (window, signal, execution, roles) =>
      streamSummary(ollama, window, signal, execution, roles, currentDate),

    summarize: async (window, signal, execution, roles) => {
      signal?.throwIfAborted();
      const messages = buildSummaryMessages(window, roles, {
        outputMode: "structured",
        reasoningEffort: SUMMARIZER_PROFILE.think,
        currentDate,
      });
      const prompt = messages.map(({ content }) => content).join("\n\n");
      execution?.record({
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
          format:
            structuredOutput === "json" ? "json" : SUMMARY_RESPONSE_SCHEMA,
          stream: false,
          messages,
        },
        { signal },
      );
      signal?.throwIfAborted();

      const durationMs = performance.now() - startedAt;
      recordModelResponse(
        execution,
        {
          stage: "summarizer",
          model: SUMMARIZER_PROFILE.model,
          attempt: 1,
          durationMs,
        },
        response,
      );

      const { summary } = parseModelOutput({
        raw: response.message.content,
        schema: summaryOutputSchema,
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        durationMs,
        attempt: 1,
        execution,
      });
      validateSemanticOutput(summary);

      execution?.record({
        type: "model.response",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        durationMs,
        responseChars: response.message.content.length,
        summaryChars: summary.length,
      });
      return { text: summary };
    },
  };
}
