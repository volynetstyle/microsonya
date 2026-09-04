import { and, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import {
  participantAliases,
  summaryRunMessages,
  summaryRuns,
  wmaChatCatalog,
  type DataEncryption,
  type MicrosonyaDb,
} from "@microsonya/db";
import type { TelegramIdentity } from "./auth.js";
import { getAccessibleTelegramChatTitle } from "./chat-access.js";
import {
  parseSummaryInline,
  renderSummaryInline,
  resolveParticipantLabel,
  type WmaParticipant,
} from "./identity-presentation.js";
import { withWorkerDatabase } from "../../runtime/worker-db.js";

const TELEGRAM_AUTH_CONCURRENCY = 4;
const SUMMARY_PAGE_SIZE = 7;

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
    participantId: string;
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
      const title = await getAccessibleTelegramChatTitle(
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
  cursor?: string,
): Promise<WmaChatOverview> {
  const chat = await authorizeChat(env, identity, chatRef);
  const pageCursor = decodeSummaryCursor(cursor);
  return withWorkerDatabase(env, async (db, encryption) => {
    const chatId = encryption.lookup(chat.id, "telegram-chat-id");
    const [rows, catalog] = await Promise.all([
      db
        .select({
          id: summaryRuns.id,
          createdAt: summaryRuns.createdAt,
          messageCount: summaryRuns.messageCount,
          summaryTextCiphertext: summaryRuns.summaryTextCiphertext,
          summaryInline: summaryRuns.summaryInline,
        })
        .from(summaryRuns)
        .where(
          and(
            eq(summaryRuns.chatId, chatId),
            eq(summaryRuns.status, "summarized"),
            isNotNull(summaryRuns.summaryTextCiphertext),
            pageCursor === undefined
              ? undefined
              : or(
                  lt(summaryRuns.createdAt, pageCursor.createdAt),
                  and(
                    eq(summaryRuns.createdAt, pageCursor.createdAt),
                    lt(summaryRuns.id, pageCursor.id),
                  ),
                ),
          ),
        )
        .orderBy(desc(summaryRuns.createdAt), desc(summaryRuns.id))
        .limit(SUMMARY_PAGE_SIZE + 1),
      db
        .select()
        .from(wmaChatCatalog)
        .where(eq(wmaChatCatalog.chatId, chatId))
        .limit(1),
    ]);
    const pageRows = rows.slice(0, SUMMARY_PAGE_SIZE);
    const lastRow = pageRows.at(-1);
    const presentation = await loadPresentation(
      db,
      encryption,
      identity.user.id,
      pageRows.map((row) => row.id),
    );
    return {
      chat: { ref: chat.id, title: chat.title },
      stats: {
        summaryCount: catalog[0]?.summaryCount ?? 0,
        messageCount: catalog[0]?.messageCount ?? 0,
      },
      summaries: pageRows.flatMap((row) => {
        if (row.summaryTextCiphertext === null) return [];
        const summary = renderStoredSummary(
          encryption.decrypt(row.summaryTextCiphertext),
          row.summaryInline,
          presentation.participants,
          presentation.aliases,
        );
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
      nextCursor:
        rows.length > SUMMARY_PAGE_SIZE && lastRow !== undefined
          ? encodeSummaryCursor(lastRow.createdAt, lastRow.id)
          : null,
    };
  });
}

function encodeSummaryCursor(createdAt: number, id: string): string {
  return `${createdAt}:${encodeURIComponent(id)}`;
}

function decodeSummaryCursor(
  cursor?: string,
): { createdAt: number; id: string } | undefined {
  if (cursor === undefined) return;
  const separator = cursor.indexOf(":");
  const createdAt = Number(cursor.slice(0, separator));
  const id =
    separator < 1 ? "" : decodeURIComponent(cursor.slice(separator + 1));
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || id.length === 0)
    throw new TypeError("Invalid summary cursor.");
  return { createdAt, id };
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
          summaryInline: summaryRuns.summaryInline,
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
    const presentation = await loadPresentation(
      db,
      encryption,
      identity.user.id,
      [run.id],
      rows,
    );
    return {
      id: run.id,
      summary: renderStoredSummary(
        encryption.decrypt(run.summaryTextCiphertext),
        run.summaryInline,
        presentation.participants,
        presentation.aliases,
      ),
      moments: rows.map((row) => ({
        id: `${run.id}:${row.ordinal}`,
        sentAt: row.sentAt,
        participantId: participantIdForAuthor(encryption, row.authorId),
        author: resolveParticipantLabel(
          participantFromRow(encryption, row),
          presentation.aliases,
        ),
        body: encryption.decrypt(row.textCiphertext),
      })),
    };
  });
}

/** Creates, updates, or removes the authenticated viewer's private alias. */
export async function setParticipantAlias(
  env: WmaEnv,
  identity: TelegramIdentity,
  input: Readonly<{
    chatRef?: string;
    participantId: string;
    displayLabel?: string;
  }>,
): Promise<void> {
  const chat = await authorizeChat(env, identity, input.chatRef);
  await withWorkerDatabase(env, async (db, encryption) => {
    const chatId = encryption.lookup(chat.id, "telegram-chat-id");
    const sources = await db
      .select({ authorId: summaryRunMessages.authorId })
      .from(summaryRunMessages)
      .where(eq(summaryRunMessages.chatId, chatId));
    const knownParticipants = new Set(
      sources.map((source) =>
        participantIdForAuthor(encryption, source.authorId),
      ),
    );
    if (!knownParticipants.has(input.participantId)) {
      throw new WmaAliasInputError("Unknown participant for this chat.");
    }
    const ownerUserId = encryption.lookup(
      identity.user.id,
      "telegram-author-id",
    );
    if (input.displayLabel === undefined) {
      await db
        .delete(participantAliases)
        .where(
          and(
            eq(participantAliases.ownerUserId, ownerUserId),
            eq(participantAliases.participantId, input.participantId),
          ),
        );
      return;
    }
    await db
      .insert(participantAliases)
      .values({
        ownerUserId,
        participantId: input.participantId,
        displayLabelCiphertext: encryption.encrypt(input.displayLabel),
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [
          participantAliases.ownerUserId,
          participantAliases.participantId,
        ],
        set: {
          displayLabelCiphertext: encryption.encrypt(input.displayLabel),
          updatedAt: Date.now(),
        },
      });
  });
}

export class WmaAliasInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WmaAliasInputError";
  }
}

function participantIdForAuthor(
  encryption: DataEncryption,
  authorId: string,
): string {
  return encryption.lookup(authorId, "wma-participant-id");
}

function participantFromRow(
  encryption: DataEncryption,
  row: Pick<
    typeof summaryRunMessages.$inferSelect,
    "authorId" | "authorNameCiphertext"
  >,
): WmaParticipant {
  return {
    id: participantIdForAuthor(encryption, row.authorId),
    sourceLabel: encryption.decrypt(row.authorNameCiphertext),
  };
}

async function loadPresentation(
  db: MicrosonyaDb,
  encryption: DataEncryption,
  viewerId: string,
  runIds: readonly string[],
  suppliedRows?: readonly (typeof summaryRunMessages.$inferSelect)[],
): Promise<
  Readonly<{
    participants: ReadonlyMap<string, WmaParticipant>;
    aliases: ReadonlyMap<string, string>;
  }>
> {
  const rows =
    suppliedRows ??
    (runIds.length === 0
      ? []
      : await db
          .select()
          .from(summaryRunMessages)
          .where(inArray(summaryRunMessages.runId, [...runIds])));
  const participants = new Map<string, WmaParticipant>();
  for (const row of rows) {
    const participant = participantFromRow(encryption, row);
    participants.set(participant.id, participant);
  }
  if (participants.size === 0) {
    return { participants, aliases: new Map() };
  }
  const ownerUserId = encryption.lookup(viewerId, "telegram-author-id");
  const aliases = await db
    .select({
      participantId: participantAliases.participantId,
      displayLabelCiphertext: participantAliases.displayLabelCiphertext,
    })
    .from(participantAliases)
    .where(
      and(
        eq(participantAliases.ownerUserId, ownerUserId),
        inArray(participantAliases.participantId, [...participants.keys()]),
      ),
    );
  return {
    participants,
    aliases: new Map(
      aliases.map((alias) => [
        alias.participantId,
        encryption.decrypt(alias.displayLabelCiphertext),
      ]),
    ),
  };
}

function renderStoredSummary(
  fallbackText: string,
  rawInline: unknown,
  participants: ReadonlyMap<string, WmaParticipant>,
  aliases: ReadonlyMap<string, string>,
): string {
  const inline = parseSummaryInline(rawInline);
  if (inline === undefined) return fallbackText;
  return renderSummaryInline(inline, participants, aliases);
}

async function authorizeChat(
  env: WmaEnv,
  identity: TelegramIdentity,
  chatRef?: string,
): Promise<{ id: string; title: string }> {
  const chatId = chatRef ?? identity.chat?.id;
  if (!chatId) throw new TypeError("A chat must be selected.");
  const title = await getAccessibleTelegramChatTitle(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    identity.user.id,
  );
  if (!title) throw new WmaChatAccessError();
  return { id: chatId, title };
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
