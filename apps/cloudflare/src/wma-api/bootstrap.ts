import { and, desc, eq } from "drizzle-orm";
import {
  dataEncryptionFromBase64,
  openWorkerDb,
  summaryRunMessages,
  summaryRuns,
  wmaChatCatalog,
} from "@microsonya/db";
import type { TelegramIdentity } from "./auth.js";

export type WmaChat = {
  ref: string;
  title: string;
  summaryCount: number;
  lastSummaryAt: number | null;
};
export type WmaChatOverview = {
  chat: { ref: string; title: string };
  stats: { summaryCount: number; messageCount: number };
  summaries: readonly WmaSummaryCard[];
};
export type WmaSummaryCard = {
  id: string;
  createdAt: number;
  messageCount: number;
  summary: string;
  preview: string;
};
export type WmaSummaryDetail = {
  id: string;
  summary: string;
  moments: readonly {
    id: string;
    sentAt: number;
    author: string;
    body: string;
  }[];
};
type WmaEnv = {
  HYPERDRIVE: Hyperdrive;
  MICROSONYA_DATA_ENCRYPTION_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
};

/** Home is backed by the WMA projection, never by lifecycle history. */
export async function listWmaChats(
  env: WmaEnv,
  identity: TelegramIdentity,
): Promise<readonly WmaChat[]> {
  const encryption = dataEncryptionFromBase64(
    env.MICROSONYA_DATA_ENCRYPTION_KEY,
  );
  const client = await openWorkerDb(env.HYPERDRIVE.connectionString);
  try {
    const catalog = await client.db
      .select()
      .from(wmaChatCatalog)
      .orderBy(desc(wmaChatCatalog.lastSummaryAt));
    const chats = await Promise.all(
      catalog.map(async (entry) => {
        const chatId = encryption.decrypt(entry.chatIdCiphertext);
        const title = await accessibleChatTitle(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          identity.user.id,
        );
        return title === undefined
          ? undefined
          : {
              ref: chatId,
              title,
              summaryCount: entry.summaryCount,
              lastSummaryAt: entry.lastSummaryAt,
            };
      }),
    );
    return chats.filter((chat): chat is WmaChat => chat !== undefined);
  } finally {
    await client.close();
  }
}

/** Overview returns headers only. Source messages are fetched by detail(). */
export async function getChatOverview(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
): Promise<WmaChatOverview> {
  const chat = await authorizeChat(env, identity, chatRef);
  const encryption = dataEncryptionFromBase64(
    env.MICROSONYA_DATA_ENCRYPTION_KEY,
  );
  const chatId = encryption.lookup(chat.id, "telegram-chat-id");
  const client = await openWorkerDb(env.HYPERDRIVE.connectionString);
  try {
    const [rows, catalog] = await Promise.all([
      client.db
        .select({
          id: summaryRuns.id,
          createdAt: summaryRuns.createdAt,
          messageCount: summaryRuns.messageCount,
          summaryTextCiphertext: summaryRuns.summaryTextCiphertext,
        })
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.chatId, chatId),
            eq(summaryRuns.status, "summarized"),
          ),
        )
        .orderBy(desc(summaryRuns.createdAt))
        .limit(20),
      client.db
        .select()
        .from(wmaChatCatalog)
        .where(eq(wmaChatCatalog.chatId, chatId))
        .limit(1),
    ]);
    return {
      chat: { ref: chat.id, title: chat.title },
      stats: {
        summaryCount: catalog[0]?.summaryCount ?? 0,
        messageCount: catalog[0]?.messageCount ?? 0,
      },
      summaries: rows.flatMap((row) => {
        if (row.summaryTextCiphertext === null) return [];
        const summary = encryption.decrypt(row.summaryTextCiphertext);
        return [
          {
            id: row.id,
            createdAt: row.createdAt,
            messageCount: row.messageCount,
            summary,
            preview: summary.slice(0, 180),
          },
        ];
      }),
    };
  } finally {
    await client.close();
  }
}

export async function getSummaryDetail(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
  summaryId?: string,
): Promise<WmaSummaryDetail> {
  const chat = await authorizeChat(env, identity, chatRef);
  if (!summaryId) throw new TypeError("A summary must be selected.");
  const encryption = dataEncryptionFromBase64(
    env.MICROSONYA_DATA_ENCRYPTION_KEY,
  );
  const client = await openWorkerDb(env.HYPERDRIVE.connectionString);
  try {
    const run = (
      await client.db
        .select({
          id: summaryRuns.id,
          summaryTextCiphertext: summaryRuns.summaryTextCiphertext,
        })
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.id, summaryId),
            eq(
              summaryRuns.chatId,
              encryption.lookup(chat.id, "telegram-chat-id"),
            ),
            eq(summaryRuns.status, "summarized"),
          ),
        )
        .limit(1)
    ).at(0);
    if (!run?.summaryTextCiphertext) throw new TypeError("Summary not found.");
    const rows = await client.db
      .select()
      .from(summaryRunMessages)
      .where(eq(summaryRunMessages.runId, run.id))
      .orderBy(summaryRunMessages.ordinal);
    return {
      id: run.id,
      summary: encryption.decrypt(run.summaryTextCiphertext),
      moments: rows.map((row) => ({
        id: `${run.id}:${row.ordinal}`,
        sentAt: row.sentAt,
        author: encryption.decrypt(row.authorNameCiphertext),
        body: encryption.decrypt(row.textCiphertext),
      })),
    };
  } finally {
    await client.close();
  }
}

async function authorizeChat(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
): Promise<{ id: string; title: string }> {
  const chatId = chatRef ?? identity.chat?.id;
  if (!chatId) throw new TypeError("A chat must be selected.");
  const title = await accessibleChatTitle(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    identity.user.id,
  );
  if (!title) throw new TypeError("The requested chat is not authorized.");
  return { id: chatId, title };
}

async function accessibleChatTitle(
  token: string,
  chatId: string,
  userId: string,
): Promise<string | undefined> {
  const member = await fetch(
    `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`,
  );
  if (!member.ok) return;
  if (!((await member.json()) as { ok?: boolean }).ok) return;
  const chat = await fetch(
    `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,
  );
  if (!chat.ok) return;
  const body = (await chat.json()) as {
    ok?: boolean;
    result?: { title?: string; first_name?: string };
  };
  return body.ok ? (body.result?.title ?? body.result?.first_name) : undefined;
}
