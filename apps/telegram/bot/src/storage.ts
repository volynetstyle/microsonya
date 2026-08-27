import type {
  ChatId,
  ChatMessage,
  MessageId,
  SummaryRun,
} from "@microsonya/shared";

export type Storage = {
  messages: InMemoryMessagesRepo;
  summaries: InMemorySummariesRepo;
};

export function createStorage(): Storage {
  return {
    messages: new InMemoryMessagesRepo(),
    summaries: new InMemorySummariesRepo(),
  };
}

export class InMemoryMessagesRepo {
  private readonly messagesByChat = new Map<
    ChatId,
    Map<MessageId, ChatMessage>
  >();

  async save(message: ChatMessage): Promise<void> {
    const messages = this.messagesByChat.get(message.chatId) ?? new Map();
    messages.set(message.id, copyMessage(message));
    this.messagesByChat.set(message.chatId, messages);
  }

  async listByChat(chatId: ChatId): Promise<readonly ChatMessage[]> {
    return Object.freeze(
      [...(this.messagesByChat.get(chatId)?.values() ?? [])]
        .sort((left, right) => left.id - right.id)
        .map(copyMessage),
    );
  }
}

export class InMemorySummariesRepo {
  private readonly runsByCommand = new Map<string, SummaryRun>();

  async findLastRun(chatId: ChatId): Promise<SummaryRun | undefined> {
    const run = [...this.runsByCommand.values()]
      .filter((candidate) => candidate.chatId === chatId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .at(0);

    return run === undefined ? undefined : copySummaryRun(run);
  }

  async saveRun(run: SummaryRun): Promise<void> {
    this.runsByCommand.set(
      `${run.chatId}:${run.commandMessageId}`,
      copySummaryRun(run),
    );
  }
}

function copyMessage(message: ChatMessage): ChatMessage {
  return Object.freeze({
    id: message.id,
    chatId: message.chatId,
    author: Object.freeze({
      id: message.author.id,
      label: message.author.label,
    }),
    time: message.time,
    parentId: message.parentId,
    text: message.text,
  });
}

function copySummaryRun(run: SummaryRun): SummaryRun {
  return Object.freeze({
    id: run.id,
    chatId: run.chatId,
    commandMessageId: run.commandMessageId,
    createdAt: run.createdAt,
    covers: Object.freeze({
      firstId: run.covers.firstId,
      lastId: run.covers.lastId,
      count: run.covers.count,
    }),
    mode: run.mode,
    status: run.status,
    action: run.action,
    finalText: run.finalText,
  });
}
