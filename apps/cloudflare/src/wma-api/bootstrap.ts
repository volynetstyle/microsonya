import { and, desc, eq } from "drizzle-orm";
import {
  summaryRunMessages,
  summaryRuns,
  wmaChatCatalog,
} from "@microsonya/db";
import type { TelegramIdentity } from "./auth.js";
import { withWorkerDatabase } from "../runtime/worker-db.js";

const TELEGRAM_AUTH_CONCURRENCY = 4;

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
type WmaEnv = Pick<
  Env,
  "HYPERDRIVE" | "MICROSONYA_DATA_ENCRYPTION_KEY" | "TELEGRAM_BOT_TOKEN"
>;

/** Home is backed by the WMA projection, never by lifecycle history. */
export async function listWmaChats(
  env: WmaEnv,
  identity: TelegramIdentity,
): Promise<readonly WmaChat[]> {
  const catalog = await withWorkerDatabase(env, async (db, encryption) =>
    (
      await db
        .select()
        .from(wmaChatCatalog)
        .orderBy(desc(wmaChatCatalog.lastSummaryAt))
    ).map((entry) => ({
      chatId: encryption.decrypt(entry.chatIdCiphertext),
      summaryCount: entry.summaryCount,
      lastSummaryAt: entry.lastSummaryAt,
    })),
  );
  const chats = await mapConcurrent(
    catalog,
    TELEGRAM_AUTH_CONCURRENCY,
    async (entry) => {
      const title = await accessibleChatTitle(
        env.TELEGRAM_BOT_TOKEN,
        entry.chatId,
        identity.user.id,
      );
      return title === undefined
        ? undefined
        : {
            ref: entry.chatId,
            title,
            summaryCount: entry.summaryCount,
            lastSummaryAt: entry.lastSummaryAt,
          };
    },
  );
  return chats.filter((chat): chat is WmaChat => chat !== undefined);
}

/** Overview returns headers only. Source messages are fetched by detail(). */
export async function getChatOverview(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
): Promise<WmaChatOverview> {
  const chat = await authorizeChat(env, identity, chatRef);
  return withWorkerDatabase(env, async (db, encryption) => {
    const chatId = encryption.lookup(chat.id, "telegram-chat-id");
    const [rows, catalog] = await Promise.all([
      db
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
      db
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
  });
}

export async function getSummaryDetail(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
  summaryId?: string,
): Promise<WmaSummaryDetail> {
  const chat = await authorizeChat(env, identity, chatRef);
  if (!summaryId) throw new TypeError("A summary must be selected.");
  return withWorkerDatabase(env, async (db, encryption) => {
    const run = (
      await db
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
    const rows = await db
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
  });
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
  const apiBase = `https://api.telegram.org/bot${token}`;
  const encodedChatId = encodeURIComponent(chatId);
  const [member, chat] = await Promise.all([
    fetch(
      `${apiBase}/getChatMember?chat_id=${encodedChatId}&user_id=${encodeURIComponent(userId)}`,
    ),
    fetch(`${apiBase}/getChat?chat_id=${encodedChatId}`),
  ]);
  if (!member.ok || !chat.ok) return;
  const [memberBody, chatBody]: [unknown, unknown] = await Promise.all([
    member.json(),
    chat.json(),
  ]);
  if (!isTelegramOk(memberBody) || !isTelegramOk(chatBody)) return;
  const result = chatBody.result;
  if (typeof result !== "object" || result === null) return;
  const { title, first_name: firstName } = result as {
    readonly title?: unknown;
    readonly first_name?: unknown;
  };
  if (typeof title === "string") return title;
  return typeof firstName === "string" ? firstName : undefined;
}

function isTelegramOk(
  value: unknown,
): value is { readonly ok: true; readonly result?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly ok?: unknown }).ok === true
  );
}

async function mapConcurrent<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}
