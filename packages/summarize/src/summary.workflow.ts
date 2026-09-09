import type { OllamaClient } from "@microsonya/model";
import type { ChatId, MessageId, SummaryCommand } from "@microsonya/shared";
import { createClassifier } from "./classifier/classifier.js";
import { executeSummaryAttempt } from "./execution/attempt.js";
import { serializeByChat } from "./execution/serialization.js";
import { createConversationSummarizer } from "./generation/summarizer.js";
import type {
  SummaryWorkflow,
  SummaryWorkflowDependencies,
} from "./summary.dependencies.js";

export function createSummaryWorkflow(
  deps: SummaryWorkflowDependencies,
): SummaryWorkflow {
  const classifier =
    deps.classifier ??
    createClassifier({
      ollama: requireOllama(deps),
      currentDate: deps.modelGeneration?.currentDate,
      structuredOutput: deps.modelGeneration?.structuredOutput,
    });

  const conversationSummarizer =
    deps.conversationSummarizer ??
    createConversationSummarizer({
      ollama: requireOllama(deps),
      currentDate: deps.modelGeneration?.currentDate,
      structuredOutput: deps.modelGeneration?.structuredOutput,
    });

  const pendingByChat = new Map<ChatId, Promise<void>>();
  const deferStreakByChat = new Map<
    ChatId,
    { readonly checkpoint?: MessageId; readonly count: number }
  >();
  const process = (command: SummaryCommand, signal?: AbortSignal) =>
    serializeByChat(pendingByChat, command.chatId, () =>
      executeSummaryAttempt(
        deps,
        classifier,
        conversationSummarizer,
        deferStreakByChat,
        command,
        signal,
      ),
    );

  return { process };
}

function requireOllama(
  deps: SummaryWorkflowDependencies,
): Pick<OllamaClient, "chat"> {
  if (!deps.ollama) {
    throw new TypeError(
      "createSummaryWorkflow requires ollama when model-facing dependencies are not injected.",
    );
  }
  return deps.ollama;
}
