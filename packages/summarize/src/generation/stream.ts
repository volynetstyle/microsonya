import type { OllamaClient } from "@microsonya/model";
import { SUMMARIZER_PROFILE } from "@microsonya/model";
import type { ConversationWindow } from "@microsonya/shared";
import type { SummaryExecutionRecorder } from "../execution/observer.js";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import { recordModelResponse } from "../model/response.js";
import { buildSummaryMessages } from "./prompt.js";
import { validateSemanticOutput } from "./validation.js";

export async function* streamSummary(
  ollama: Pick<OllamaClient, "chat">,
  window: ConversationWindow,
  signal?: AbortSignal,
  execution?: SummaryExecutionRecorder,
  roles?: readonly ModelWindowMessageRole[],
  currentDate?: string,
): AsyncIterable<string> {
  signal?.throwIfAborted();

  const messages = buildSummaryMessages(window, roles, {
    outputMode: "plain-text",
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
  let content = "";
  let done = false;
  let doneReason: string | undefined;
  let promptEvalCount: number | undefined;
  let evalCount: number | undefined;
  let thinking = "";

  for await (const event of ollama.chat(
    {
      ...SUMMARIZER_PROFILE,
      format: undefined,
      stream: true,
      messages,
    },
    { signal },
  )) {
    signal?.throwIfAborted();
    done = event.done;
    doneReason = event.done_reason;
    promptEvalCount = event.prompt_eval_count;
    evalCount = event.eval_count;
    thinking += event.message.thinking ?? "";
    const delta = event.message.content;
    if (delta.length > 0) {
      content += delta;
      yield delta;
    }
  }
  const durationMs = performance.now() - startedAt;

  validateSemanticOutput(content);

  recordModelResponse(
    execution,
    {
      stage: "summarizer",
      model: SUMMARIZER_PROFILE.model,
      attempt: 1,
      durationMs,
    },
    {
      done,
      done_reason: doneReason,
      prompt_eval_count: promptEvalCount,
      eval_count: evalCount,
      message: { role: "assistant", content, thinking },
    },
  );
  execution?.record({
    type: "model.response",
    stage: "summarizer",
    model: SUMMARIZER_PROFILE.model,
    attempt: 1,
    durationMs,
    responseChars: content.length,
    summaryChars: content.length,
  });
}
