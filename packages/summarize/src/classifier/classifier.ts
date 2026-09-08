import type { OllamaClient } from "@microsonya/model";
import { CLASSIFIER_PROFILE } from "@microsonya/model";
import type { ConversationWindow, SummaryDecision } from "@microsonya/shared";
import type { SummaryExecutionRecorder } from "../execution/observer.js";
import { ModelOutputError, parseModelOutput } from "../model/output.js";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import { recordModelResponse } from "../model/response.js";
import { classifierOutputSchema, decideFromPredicates } from "./predicates.js";
import { buildClassifierPrompt } from "./prompt.js";

export interface SummaryDecisionClassifier {
  classify(
    window: ConversationWindow,
    signal?: AbortSignal,
    execution?: SummaryExecutionRecorder,
    roles?: readonly ModelWindowMessageRole[],
  ): Promise<SummaryDecision>;
}

export interface ClassifierDependencies {
  readonly ollama: Pick<OllamaClient, "chat">;
}

export function createClassifier(
  deps: ClassifierDependencies,
): SummaryDecisionClassifier {
  return {
    classify: async (window, signal, execution, roles) => {
      signal?.throwIfAborted();
      const prompt = buildClassifierPrompt(window, roles);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const numPredict =
          CLASSIFIER_PROFILE.options.num_predict * (attempt === 1 ? 1 : 2);
        execution?.record({
          type: "model.request",
          stage: "classifier",
          model: CLASSIFIER_PROFILE.model,
          attempt,
          numPredict,
          messageCount: window.messages.length,
          promptChars: prompt.length,
          prompt,
        });
        const startedAt = performance.now();
        const response = await deps.ollama.chat(
          {
            ...CLASSIFIER_PROFILE,
            options: {
              ...CLASSIFIER_PROFILE.options,
              num_predict: numPredict,
            },
            stream: false,
            messages: [{ role: "user", content: prompt }],
          },
          { signal },
        );
        signal?.throwIfAborted();

        const durationMs = performance.now() - startedAt;
        recordModelResponse(
          execution,
          {
            stage: "classifier",
            model: CLASSIFIER_PROFILE.model,
            attempt: attempt,
            durationMs,
          },
          response,
        );

        try {
          const predicates = parseModelOutput({
            raw: response.message.content,
            schema: classifierOutputSchema,
            stage: "classifier",
            model: CLASSIFIER_PROFILE.model,
            durationMs,
            attempt,
            execution,
          });
          const action = decideFromPredicates(predicates);
          execution?.record({
            type: "model.response",
            stage: "classifier",
            model: CLASSIFIER_PROFILE.model,
            attempt,
            durationMs,
            responseChars: response.message.content.length,
            action,
            predicates,
          });
          return {
            action,
            evidence: {
              source: "model",
              model: CLASSIFIER_PROFILE.model,
            },
          };
        } catch (error) {
          const retryableOutputFailure =
            error instanceof ModelOutputError &&
            (error.code === "MODEL_OUTPUT_EMPTY" ||
              response.done_reason === "length");
          if (retryableOutputFailure && attempt === 1) {
            execution?.record({
              type: "model.request.retry",
              stage: "classifier",
              model: CLASSIFIER_PROFILE.model,
              failedAttempt: attempt,
              nextAttempt: attempt + 1,
              reason: error.code,
            });
            continue;
          }
          throw error;
        }
      }

      throw new Error("Classifier retry loop exited without a decision.");
    },
  };
}
