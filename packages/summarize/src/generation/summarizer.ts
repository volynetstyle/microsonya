import type { OllamaClient } from "@microsonya/model";
import { SUMMARIZER_PROFILE } from "@microsonya/model";
import type { ConversationWindow, Summary } from "@microsonya/shared";
import type { SummaryExecutionRecorder } from "../execution/observer.js";
import { parseModelOutput } from "../model/output.js";
import type {
  ModelWindowMessageRole,
  ReasoningEffort,
} from "../model/prompt.js";
import { recordModelResponse } from "../model/response.js";
import {
  SummaryAcceptanceError,
  acceptSummaryCandidate,
} from "./acceptance.js";
import { buildSummaryMessages } from "./prompt.js";
import { SUMMARY_RESPONSE_SCHEMA, summaryOutputSchema } from "./schema.js";

export interface ConversationSummarizer {
  summarize(
    window: ConversationWindow,
    signal?: AbortSignal,
    execution?: SummaryExecutionRecorder,
    roles?: readonly ModelWindowMessageRole[],
  ): Promise<Summary>;
}

export interface ConversationSummarizerDependencies {
  readonly ollama: Pick<OllamaClient, "chat">;
  readonly currentDate?: string;
  readonly structuredOutput?: "schema" | "json";
  readonly reasoningEffort?: ReasoningEffort;
}

export function createConversationSummarizer({
  ollama,
  currentDate,
  structuredOutput = "schema",
  reasoningEffort = SUMMARIZER_PROFILE.think,
}: ConversationSummarizerDependencies): ConversationSummarizer {
  return {
    summarize: async (window, signal, execution, roles) => {
      signal?.throwIfAborted();
      const messages = buildSummaryMessages(window, roles, {
        reasoningEffort,
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
          think: reasoningEffort,
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

      const candidate = parseModelOutput({
        raw: response.message.content,
        schema: summaryOutputSchema,
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        durationMs,
        attempt: 1,
        execution,
      });
      let summary: string;
      try {
        summary = acceptSummaryCandidate(candidate, window, roles);
      } catch (error) {
        if (error instanceof SummaryAcceptanceError) {
          execution?.record({
            type: "model.response.invalid",
            stage: "summarizer",
            model: SUMMARIZER_PROFILE.model,
            attempt: 1,
            durationMs,
            responseChars: response.message.content.length,
            reason: error.code,
          });
        }
        throw error;
      }

      execution?.record({
        type: "model.response",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        durationMs,
        responseChars: response.message.content.length,
        summaryChars: summary.length,
        claimCount: candidate.claims.length,
      });
      return { text: summary };
    },
  };
}
