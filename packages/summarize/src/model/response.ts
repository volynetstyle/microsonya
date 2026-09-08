import type { ChatResponse } from "@microsonya/model";
import type { ModelStage } from "../execution/events.js";
import type { SummaryExecutionRecorder } from "../execution/observer.js";

type ResponseEnvelope = Pick<
  ChatResponse,
  "message" | "done" | "done_reason" | "prompt_eval_count" | "eval_count"
>;

/** One evidence envelope for complete responses and accumulated streams. */
export function recordModelResponse(
  execution: SummaryExecutionRecorder | undefined,
  invocation: {
    readonly stage: ModelStage;
    readonly model: string;
    readonly attempt: number;
    readonly durationMs: number;
  },
  response: ResponseEnvelope,
): void {
  execution?.record({
    type: "model.response.envelope",
    ...invocation,
    done: response.done,
    doneReason: response.done_reason,
    promptEvalCount: response.prompt_eval_count,
    evalCount: response.eval_count,
    contentChars: response.message.content.length,
    thinkingChars: response.message.thinking?.length ?? 0,
    content: response.message.content,
    thinking: response.message.thinking,
  });
}
