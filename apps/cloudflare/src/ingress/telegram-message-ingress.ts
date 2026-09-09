import { MessageHistoryRepository } from "@microsonya/db";
import type { ChatMessage } from "@microsonya/shared";
import { tracing } from "cloudflare:workers";
import { withWorkerDatabase } from "../runtime/worker-db.js";

type MessageIngressEnv = Pick<
  Env,
  "HYPERDRIVE" | "MICROSONYA_DATA_ENCRYPTION_KEY"
>;

export async function persistTelegramMessage(
  env: MessageIngressEnv,
  message: ChatMessage,
): Promise<void> {
  await tracing.enterSpan("telegram.message.persist", (span) => {
    span.setAttribute("microsonya.message_kind", "chat_message");
    return withWorkerDatabase(env, (db, encryption) =>
      new MessageHistoryRepository(db, encryption).save(message),
    );
  });
}
