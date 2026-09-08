import { and, desc, eq, isNotNull, lt, or } from "drizzle-orm";

import {
  summaryRunMessages,
  summaryRuns,
  wmaChatCatalog,
} from "@microsonya/db";

import type { TelegramIdentity } from "./auth.js";
import {
  getAccessibleTelegramChat,
  isTelegramChatAccessible,
} from "./chat-access.js";
import { withWorkerDatabase } from "../../runtime/worker-db.js";

const TELEGRAM_AUTH_CONCURRENCY = 4;
const SUMMARY_PAGE_SIZE = 7;

export type WmaChat = {
  ref: string;
  title: string;
  photoFileId?: string;
  summaryCount: number;
  lastSummaryAt: number | null;
};

export type WmaChatOverview = {
  chat: {
    ref: string;
    title: string;
    photoFileId?: string;
  };
  stats: {
    summaryCount: number;
    messageCount: number;
  };
  summaries: readonly WmaSummaryCard[];
  nextCursor: string | null;
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
  | "HYPERDRIVE"
  | "MICROSONYA_DATA_ENCRYPTION_KEY"
  | "TELEGRAM_BOT_TOKEN"
>;

type CatalogEntry = {
  chatId: string;
  summaryCount: number;
  lastSummaryAt: number | null;
};

type AccessibleChat = {
  id: string;
  title: string;
  photoFileId?: string;
};

/**
 * Home is backed by the WMA projection, never lifecycle history.
 */
export async function listWmaChats(
  env: WmaEnv,
  identity: TelegramIdentity,
): Promise<readonly WmaChat[]> {
  const catalog = await loadChatCatalog(env);

  const chats = await mapConcurrent(
    catalog,
    TELEGRAM_AUTH_CONCURRENCY,
    async (entry): Promise<WmaChat | undefined> => {
      const chat = await getAccessibleTelegramChat(
        env.TELEGRAM_BOT_TOKEN,
        entry.chatId,
        identity.user.id,
      );

      if (!chat) return;

      return {
        ref: entry.chatId,
        title: chat.title,
        ...(chat.photoFileId === undefined
          ? {}
          : { photoFileId: chat.photoFileId }),
        summaryCount: entry.summaryCount,
        lastSummaryAt: entry.lastSummaryAt,
      };
    },
  );

  return chats.filter(isDefined);
}

/**
 * Overview contains summary cards but does not load source messages.
 */
export async function getChatOverview(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
  cursor?: string,
): Promise<WmaChatOverview> {
  const chat = await requireAccessibleChat(
    env,
    identity,
    chatRef,
  );

  const pageCursor = decodeSummaryCursor(cursor);

  return withWorkerDatabase(env, async (db, encryption) => {
    const chatId = encryption.lookup(
      chat.id,
      "telegram-chat-id",
    );

    const cursorCondition =
      pageCursor === undefined
        ? undefined
        : or(
            lt(summaryRuns.createdAt, pageCursor.createdAt),
            and(
              eq(summaryRuns.createdAt, pageCursor.createdAt),
              lt(summaryRuns.id, pageCursor.id),
            ),
          );

    const [rows, stats] = await Promise.all([
      db
        .select({
          id: summaryRuns.id,
          createdAt: summaryRuns.createdAt,
          messageCount: summaryRuns.messageCount,
          summaryTextCiphertext:
            summaryRuns.summaryTextCiphertext,
        })
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.chatId, chatId),
            eq(summaryRuns.status, "summarized"),
            isNotNull(summaryRuns.summaryTextCiphertext),
            cursorCondition,
          ),
        )
        .orderBy(
          desc(summaryRuns.createdAt),
          desc(summaryRuns.id),
        )
        .limit(SUMMARY_PAGE_SIZE + 1),

      db
        .select({
          summaryCount: wmaChatCatalog.summaryCount,
          messageCount: wmaChatCatalog.messageCount,
        })
        .from(wmaChatCatalog)
        .where(eq(wmaChatCatalog.chatId, chatId))
        .limit(1),
    ]);

    const pageRows = rows.slice(0, SUMMARY_PAGE_SIZE);
    const lastRow = pageRows.at(-1);

    return {
      chat: {
        ref: chat.id,
        title: chat.title,
        ...(chat.photoFileId === undefined
          ? {}
          : { photoFileId: chat.photoFileId }),
      },

      stats: {
        summaryCount: stats[0]?.summaryCount ?? 0,
        messageCount: stats[0]?.messageCount ?? 0,
      },

      summaries: pageRows.map((row) => {
        if (row.summaryTextCiphertext === null) {
          throw new Error(
            "Invariant violated: summarized run has no summary text.",
          );
        }

        const summary = encryption.decrypt(
          row.summaryTextCiphertext,
        );

        return {
          id: row.id,
          createdAt: row.createdAt,
          messageCount: row.messageCount,
          summary,
          preview: summary.slice(0, 180),
        };
      }),

      nextCursor:
        rows.length > SUMMARY_PAGE_SIZE &&
        lastRow !== undefined
          ? encodeSummaryCursor(
              lastRow.createdAt,
              lastRow.id,
            )
          : null,
    };
  });
}

/**
 * Detail needs authorization, but does not need Telegram presentation metadata.
 */
export async function getSummaryDetail(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
  summaryId?: string,
): Promise<WmaSummaryDetail> {
  if (!summaryId) {
    throw new TypeError("A summary must be selected.");
  }

  const chatId = await requireAccessibleChatId(
    env,
    identity,
    chatRef,
  );

  return withWorkerDatabase(env, async (db, encryption) => {
    const storedChatId = encryption.lookup(
      chatId,
      "telegram-chat-id",
    );

    const run = (
      await db
        .select({
          id: summaryRuns.id,
          summaryTextCiphertext:
            summaryRuns.summaryTextCiphertext,
        })
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.id, summaryId),
            eq(summaryRuns.chatId, storedChatId),
            eq(summaryRuns.status, "summarized"),
            isNotNull(summaryRuns.summaryTextCiphertext),
          ),
        )
        .limit(1)
    ).at(0);

    if (!run || run.summaryTextCiphertext === null) {
      throw new TypeError("Summary not found.");
    }

    const rows = await db
      .select({
        ordinal: summaryRunMessages.ordinal,
        sentAt: summaryRunMessages.sentAt,
        authorNameCiphertext:
          summaryRunMessages.authorNameCiphertext,
        textCiphertext:
          summaryRunMessages.textCiphertext,
      })
      .from(summaryRunMessages)
      .where(eq(summaryRunMessages.runId, run.id))
      .orderBy(summaryRunMessages.ordinal);

    return {
      id: run.id,
      summary: encryption.decrypt(
        run.summaryTextCiphertext,
      ),
      moments: rows.map((row) => ({
        id: `${run.id}:${row.ordinal}`,
        sentAt: row.sentAt,
        author: encryption.decrypt(
          row.authorNameCiphertext,
        ),
        body: encryption.decrypt(row.textCiphertext),
      })),
    };
  });
}

async function loadChatCatalog(
  env: WmaEnv,
): Promise<readonly CatalogEntry[]> {
  return withWorkerDatabase(
    env,
    async (db, encryption): Promise<CatalogEntry[]> => {
      const rows = await db
        .select({
          chatIdCiphertext:
            wmaChatCatalog.chatIdCiphertext,
          summaryCount: wmaChatCatalog.summaryCount,
          lastSummaryAt:
            wmaChatCatalog.lastSummaryAt,
        })
        .from(wmaChatCatalog)
        .orderBy(desc(wmaChatCatalog.lastSummaryAt));

      return rows.map((row) => ({
        chatId: encryption.decrypt(
          row.chatIdCiphertext,
        ),
        summaryCount: row.summaryCount,
        lastSummaryAt: row.lastSummaryAt,
      }));
    },
  );
}

function resolveChatId(
  identity: TelegramIdentity,
  chatRef?: string,
): string {
  const chatId = chatRef ?? identity.chat?.id;

  if (!chatId) {
    throw new TypeError("A chat must be selected.");
  }

  return chatId;
}

async function requireAccessibleChatId(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
): Promise<string> {
  const chatId = resolveChatId(identity, chatRef);

  const accessible = await isTelegramChatAccessible(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    identity.user.id,
  );

  if (!accessible) {
    throw new WmaChatAccessError();
  }

  return chatId;
}

async function requireAccessibleChat(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
): Promise<AccessibleChat> {
  const chatId = resolveChatId(identity, chatRef);

  const chat = await getAccessibleTelegramChat(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    identity.user.id,
  );

  if (!chat) {
    throw new WmaChatAccessError();
  }

  return {
    id: chatId,
    title: chat.title,
    ...(chat.photoFileId === undefined
      ? {}
      : { photoFileId: chat.photoFileId }),
  };
}

function encodeSummaryCursor(
  createdAt: number,
  id: string,
): string {
  return `${createdAt}:${encodeURIComponent(id)}`;
}

function decodeSummaryCursor(
  cursor?: string,
): { createdAt: number; id: string } | undefined {
  if (cursor === undefined) return;

  const separator = cursor.indexOf(":");

  if (separator <= 0 || separator === cursor.length - 1) {
    throw invalidSummaryCursor();
  }

  const createdAtText = cursor.slice(0, separator);

  if (!/^\d+$/.test(createdAtText)) {
    throw invalidSummaryCursor();
  }

  const createdAt = Number(createdAtText);

  if (!Number.isSafeInteger(createdAt)) {
    throw invalidSummaryCursor();
  }

  let id: string;

  try {
    id = decodeURIComponent(
      cursor.slice(separator + 1),
    );
  } catch {
    throw invalidSummaryCursor();
  }

  if (id.length === 0) {
    throw invalidSummaryCursor();
  }

  return { createdAt, id };
}

function invalidSummaryCursor(): TypeError {
  return new TypeError("Invalid summary cursor.");
}

function isDefined<T>(
  value: T | undefined,
): value is T {
  return value !== undefined;
}

export class WmaChatAccessError extends Error {
  constructor() {
    super("The requested chat is not authorized.");
    this.name = "WmaChatAccessError";
  }
}

async function mapConcurrent<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1
  ) {
    throw new RangeError(
      "Concurrency must be a positive integer.",
    );
  }

  const results = new Array<Output>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;

      if (index >= values.length) {
        return;
      }

      results[index] = await mapper(values[index]!);
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          concurrency,
          values.length,
        ),
      },
      worker,
    ),
  );

  return results;
}