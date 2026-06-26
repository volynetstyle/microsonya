import type { ChatMessage, SegmentSummary, SummaryRun } from "@microsonya/shared";
import type { MessageSink } from "../telegram/ingest.js";

export type SummaryMessagesStore = {
  listByChat(chatId: string): Promise<ChatMessage[]>;
};

export type SummaryRunsStore = {
  findLastRun(chatId: string): Promise<SummaryRun | undefined>;
  saveRun(run: SummaryRun): Promise<void>;
  findCachedSegment(
    chatId: string,
    fromMessageId: number,
    toMessageId: number,
    hash: string,
    schemaVersion?: number,
  ): Promise<SegmentSummary | undefined>;
  saveSegment(summary: SegmentSummary, schemaVersion?: number): Promise<void>;
};

export class InMemoryMessagesRepo implements MessageSink, SummaryMessagesStore {
  private readonly messages = new Map<string, ChatMessage>();

  async save(message: ChatMessage): Promise<void> {
    this.messages.set(messageKey(message.chatId, message.id), message);
  }

  async listByChat(chatId: string): Promise<ChatMessage[]> {
    return [...this.messages.values()]
      .filter((message) => message.chatId === chatId)
      .sort((left, right) => left.id - right.id);
  }
}

export class InMemorySummariesRepo implements SummaryRunsStore {
  private readonly runs = new Map<string, SummaryRun>();
  private readonly segments = new Map<string, SegmentSummary>();

  async findLastRun(chatId: string): Promise<SummaryRun | undefined> {
    return [...this.runs.values()]
      .filter((run) => run.chatId === chatId && run.status === "ok")
      .sort((left, right) => right.createdAt - left.createdAt)
      .at(0);
  }

  async saveRun(run: SummaryRun): Promise<void> {
    this.runs.set(`${run.chatId}:${run.commandMessageId}`, run);
  }

  async findCachedSegment(
    chatId: string,
    fromMessageId: number,
    toMessageId: number,
    hash: string,
    schemaVersion = 1,
  ): Promise<SegmentSummary | undefined> {
    return this.segments.get(
      segmentKey(chatId, fromMessageId, toMessageId, hash, schemaVersion),
    );
  }

  async saveSegment(summary: SegmentSummary, schemaVersion = 1): Promise<void> {
    this.segments.set(
      segmentKey(
        summary.chatId,
        summary.fromMessageId,
        summary.toMessageId,
        summary.hash,
        schemaVersion,
      ),
      summary,
    );
  }
}

function messageKey(chatId: string, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function segmentKey(
  chatId: string,
  fromMessageId: number,
  toMessageId: number,
  hash: string,
  schemaVersion: number,
): string {
  return `${chatId}:${fromMessageId}:${toMessageId}:${hash}:${schemaVersion}`;
}
