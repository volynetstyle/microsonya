import type { ChatMessage, MemoryState, SummaryRun } from "@microsonya/shared";
import type { SegmentReconstruction } from "@microsonya/discourse";
import type { MessageSink } from "../telegram/ingest.js";

export type SummaryMessagesStore = {
  listByChat(chatId: string): Promise<ChatMessage[]>;
  listAfterByChat(
    chatId: string,
    afterMessageId: number,
    limit: number,
  ): Promise<ChatMessage[]>;
};

export type SummaryRunsStore = {
  findLastRun(chatId: string): Promise<SummaryRun | undefined>;
  saveRun(run: SummaryRun): Promise<void>;
  findCachedReconstruction(
    chatId: string,
    fromMessageId: number,
    toMessageId: number,
    hash: string,
    schemaVersion?: number,
  ): Promise<SegmentReconstruction | undefined>;
  saveReconstruction(
    segment: SegmentReconstruction,
    schemaVersion?: number,
  ): Promise<void>;
};

export type MemoryStateStore = {
  findState(chatId: string): Promise<MemoryState | undefined>;
  saveState(state: MemoryState, expectedVersion: number): Promise<boolean>;
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

  async listAfterByChat(
    chatId: string,
    afterMessageId: number,
    limit: number,
  ): Promise<ChatMessage[]> {
    return [...this.messages.values()]
      .filter(
        (message) => message.chatId === chatId && message.id > afterMessageId,
      )
      .sort((left, right) => left.id - right.id)
      .slice(0, limit);
  }
}

export class InMemorySummariesRepo implements SummaryRunsStore {
  private readonly runs = new Map<string, SummaryRun>();
  private readonly segments = new Map<string, SegmentReconstruction>();

  async findLastRun(chatId: string): Promise<SummaryRun | undefined> {
    return [...this.runs.values()]
      .filter((run) => run.chatId === chatId && run.status === "ok")
      .sort((left, right) => right.createdAt - left.createdAt)
      .at(0);
  }

  async saveRun(run: SummaryRun): Promise<void> {
    this.runs.set(`${run.chatId}:${run.commandMessageId}`, run);
  }

  async findCachedReconstruction(
    chatId: string,
    fromMessageId: number,
    toMessageId: number,
    hash: string,
    schemaVersion = 1,
  ): Promise<SegmentReconstruction | undefined> {
    return this.segments.get(
      segmentKey(chatId, fromMessageId, toMessageId, hash, schemaVersion),
    );
  }

  async saveReconstruction(
    segment: SegmentReconstruction,
    schemaVersion = 1,
  ): Promise<void> {
    this.segments.set(
      segmentKey(
        segment.chatId,
        segment.fromMessageId,
        segment.toMessageId,
        segment.hash,
        schemaVersion,
      ),
      segment,
    );
  }
}

export class InMemoryMemoriesRepo implements MemoryStateStore {
  private readonly states = new Map<string, MemoryState>();

  async findState(chatId: string): Promise<MemoryState | undefined> {
    const state = this.states.get(chatId);
    return state ? structuredClone(state) : undefined;
  }

  async saveState(
    state: MemoryState,
    expectedVersion: number,
  ): Promise<boolean> {
    const currentVersion = this.states.get(state.chatId)?.version ?? 0;
    if (
      currentVersion !== expectedVersion ||
      state.version !== expectedVersion + 1
    ) {
      return false;
    }

    this.states.set(state.chatId, structuredClone(state));
    return true;
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
