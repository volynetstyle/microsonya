import { SUMMARIZER_PROFILE, type OllamaClient } from "@microsonya/model";
import type { ConversationWindow } from "@microsonya/shared";
import type { SummaryExecutionRecorder } from "../execution/observer.js";
import { parseModelOutput } from "../model/output.js";
import type {
  ModelWindowMessageRole,
  ReasoningEffort,
} from "../model/prompt.js";
import { recordModelResponse } from "../model/response.js";
import { buildSummaryMessages } from "./prompt.js";
import {
  SUMMARY_RESPONSE_SCHEMA,
  summaryOutputSchema,
  type SummaryCandidate,
} from "./schema.js";
import { SUMMARY_REPAIR_INSTRUCTIONS, type SummaryRepair } from "./repair.js";

export interface ConversationSummarizer {
  summarize(
    window: ConversationWindow,
    signal?: AbortSignal,
    execution?: SummaryExecutionRecorder,
    roles?: readonly ModelWindowMessageRole[],
    repair?: SummaryRepair,
  ): Promise<SummaryCandidate>;
}
export interface ConversationSummarizerDependencies {
  readonly ollama: Pick<OllamaClient, "chat">;
  readonly currentDate?: string;
  readonly structuredOutput?: "schema" | "json";
  readonly reasoningEffort?: ReasoningEffort;
}

/** Generates candidates only. Acceptance belongs to the workflow. */
export function createConversationSummarizer({
  ollama,
  currentDate,
  structuredOutput = "schema",
  reasoningEffort = SUMMARIZER_PROFILE.think,
}: ConversationSummarizerDependencies): ConversationSummarizer {
  return {
    async summarize(window, signal, execution, roles, repair) {
      signal?.throwIfAborted();
      const attempt = repair === undefined ? 1 : 2;
      const messages = buildSummaryMessages(window, roles, {
        reasoningEffort,
        currentDate,
      });
      if (repair !== undefined) {
        messages[0] = {
          role: "system",
          content: messages[0]!.content + "\n\n" + SUMMARY_REPAIR_INSTRUCTIONS,
        };
        messages.push({ role: "user", content: JSON.stringify({ repair }) });
      }
      const prompt = messages.map(({ content }) => content).join("\n\n");
      execution?.record({
        type: "model.request",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        attempt,
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
          attempt,
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
        attempt,
        execution,
      });
      execution?.record({
        type: "model.response",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        attempt,
        durationMs,
        responseChars: response.message.content.length,
        fragmentCount: candidate.fragments.length,
      });
      return candidate;
    },
  };
}
