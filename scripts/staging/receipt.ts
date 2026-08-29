import {
  printStagingTarget,
  stagingDatabaseTarget,
  withStagingClient,
} from "./database.js";

const target = stagingDatabaseTarget();
printStagingTarget(target);
const messageIdArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--message-id="));
const messageId = messageIdArgument
  ? Number(messageIdArgument.slice("--message-id=".length))
  : undefined;
if (messageId !== undefined && !Number.isSafeInteger(messageId)) {
  throw new Error("--message-id must be a safe integer.");
}

await withStagingClient(async (client) => {
  const messages = await client.query<{
    message_id: number;
    date: string;
    kind: string;
    is_command: boolean;
  }>(
    `select message_id, date::text, kind, is_command
     from messages
     order by date desc
     limit 10`,
  );
  const runs = await client.query<{
    id: string;
    command_message_id: number;
    status: string;
    attempt: number;
    last_error_code: string | null;
    processor_version: string | null;
    model: string | null;
    prompt_version: string | null;
    delivered_at: string | null;
    telegram_message_id: number | null;
    created_at: string;
    updated_at: string;
  }>(
    `select id, command_message_id, status, attempt, last_error_code,
            processor_version, model, prompt_version, delivered_at::text,
            telegram_message_id, created_at::text, updated_at::text
     from summary_run_lifecycle
     order by created_at desc
     limit 10`,
  );

  console.info(
    `Persisted messages (metadata only): ${JSON.stringify(messages.rows)}`,
  );
  console.info(`Summary lifecycle receipt: ${JSON.stringify(runs.rows)}`);

  if (messageId !== undefined) {
    const duplicateCheck = await client.query<{ count: string }>(
      `select count(*)::text as count
       from messages
       where message_id = $1`,
      [messageId],
    );
    console.info(
      `Canonical message count for ${messageId}: ${duplicateCheck.rows[0]?.count ?? "0"}`,
    );
  }
});
