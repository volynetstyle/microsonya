import { and, desc, eq, inArray } from "drizzle-orm";
import {
  dataEncryptionFromBase64,
  openWorkerDb,
  summaryRuns,
  summaryRunMessages,
  summaryRunLifecycle,
} from "@microsonya/db";
import type { TelegramIdentity } from "./auth.js";

export type WmaBootstrap = {
  viewer: { id: string; name: string };
  chat: { id: string; title: string };
  date: string;
  totalMessages: number;
  topics: readonly WmaTopic[];
  capabilities: { canRequestSummary: boolean };
};
type WmaTopic = {
  id: string;
  title: string;
  messageCount: number;
  timeRange: string;
  preview: string;
  keyPointsCount: number;
  moments: readonly {
    type: "text";
    id: string;
    time: string;
    title: string;
    body: string;
  }[];
};

export async function loadWmaBootstrap(
  env: { HYPERDRIVE: Hyperdrive; MICROSONYA_DATA_ENCRYPTION_KEY: string },
  identity: TelegramIdentity,
  requestedChatId = identity.chat?.id,
  timeZone?: string,
): Promise<WmaBootstrap> {
  if (!requestedChatId) throw new TypeError("A chat must be selected.");
  const chat =
    identity.chat?.id === requestedChatId
      ? identity.chat
      : { id: requestedChatId, title: "Microsonya" };
  const encryption = dataEncryptionFromBase64(
    env.MICROSONYA_DATA_ENCRYPTION_KEY,
  );
  const client = await openWorkerDb(env.HYPERDRIVE.connectionString);
  try {
    const rows = await client.db
      .select()
      .from(summaryRuns)
      .where(
        and(
          eq(
            summaryRuns.chatId,
            encryption.lookup(chat.id, "telegram-chat-id"),
          ),
          inArray(summaryRuns.status, ["summarized", "skipped"]),
        ),
      )
      .orderBy(desc(summaryRuns.createdAt))
      .limit(20);
    const sourceMessages =
      rows.length === 0
        ? []
        : await client.db
            .select()
            .from(summaryRunMessages)
            .where(
              inArray(
                summaryRunMessages.runId,
                rows.map((row) => row.id),
              ),
            )
            .orderBy(summaryRunMessages.runId, summaryRunMessages.ordinal);
    const messagesByRun = new Map<string, typeof sourceMessages>();
    for (const message of sourceMessages) {
      const messages = messagesByRun.get(message.runId) ?? [];
      messages.push(message);
      messagesByRun.set(message.runId, messages);
    }
    const topics = rows.flatMap((row) => {
      if (!row.summaryTextCiphertext) return [];
      const summary = encryption.decrypt(row.summaryTextCiphertext);
      const time = new Date(row.createdAt).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      });
      if (isNonSummary(summary)) return [];
      return [
        {
          id: row.id,
          title: "Підсумок",
          messageCount: row.messageCount,
          timeRange: time,
          preview: summary.slice(0, 180),
          keyPointsCount: 1,
          moments: (messagesByRun.get(row.id) ?? []).map((message) => ({
            type: "text" as const,
            id: `${row.id}:${message.ordinal}`,
            time: new Date(message.sentAt).toLocaleTimeString("uk-UA", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone,
            }),
            title: encryption.decrypt(message.authorNameCiphertext),
            body: encryption.decrypt(message.textCiphertext),
          })) /*
            {
              type: "text" as const,
              id: `${row.id}:summary`,
              time,
              title: "Підсумок розмови",
              body: summary,
            },
          ], */,
        },
      ];
    });
    return {
      viewer: identity.user,
      chat,
      date: "сьогодні",
      totalMessages: rows.reduce((total, row) => total + row.messageCount, 0),
      topics,
      capabilities: { canRequestSummary: false },
    };
  } finally {
    await client.close();
  }
}

function isNonSummary(summary: string): boolean {
  return /(?:окремий\s+підсумок\s+не\s+створюю|не\s+створюю\s+окремий\s+підсумок)/iu.test(
    summary,
  );
}

export type WmaChat = { id: string; title: string; summaryCount: number };

export async function listWmaChats(
  env: {
    HYPERDRIVE: Hyperdrive;
    MICROSONYA_DATA_ENCRYPTION_KEY: string;
    TELEGRAM_BOT_TOKEN: string;
  },
  identity: TelegramIdentity,
): Promise<readonly WmaChat[]> {
  const encryption = dataEncryptionFromBase64(
    env.MICROSONYA_DATA_ENCRYPTION_KEY,
  );
  const client = await openWorkerDb(env.HYPERDRIVE.connectionString);
  try {
    const rows = await client.db
      .select({ chatIdCiphertext: summaryRunLifecycle.chatIdCiphertext })
      .from(summaryRunLifecycle)
      .limit(100);
    const chatIds = [
      ...new Set(
        rows.map(({ chatIdCiphertext }) =>
          encryption.decrypt(chatIdCiphertext),
        ),
      ),
    ];
    const chats = await Promise.all(
      chatIds.map(async (id) => {
        if (
          !(await telegramMember(env.TELEGRAM_BOT_TOKEN, id, identity.user.id))
        )
          return;
        const title = await telegramChatTitle(env.TELEGRAM_BOT_TOKEN, id);
        if (!title) return;
        const summaries = await client.db
          .select({ id: summaryRuns.id })
          .from(summaryRuns)
          .where(
            and(
              eq(summaryRuns.chatId, encryption.lookup(id, "telegram-chat-id")),
              inArray(summaryRuns.status, ["summarized", "skipped"]),
            ),
          );
        return { id, title, summaryCount: summaries.length };
      }),
    );
    return chats.filter((chat): chat is WmaChat => chat !== undefined);
  } finally {
    await client.close();
  }
}

async function telegramMember(
  token: string,
  chatId: string,
  userId: string,
): Promise<boolean> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`,
  );
  return (
    response.ok && ((await response.json()) as { ok?: boolean }).ok === true
  );
}
async function telegramChatTitle(
  token: string,
  chatId: string,
): Promise<string | undefined> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,
  );
  const body = (await response.json()) as {
    ok?: boolean;
    result?: { title?: string; first_name?: string };
  };
  return body.ok ? (body.result?.title ?? body.result?.first_name) : undefined;
}
