import type { ChatMessage, SummaryRun } from "@microsonya/shared";

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
  private readonly messagesByChat = new Map<string, Map<number, ChatMessage>>();

  async save(message: ChatMessage): Promise<void> {
    const messages = this.messagesByChat.get(message.chatId) ?? new Map();
    messages.set(message.id, { ...message });
    this.messagesByChat.set(message.chatId, messages);
  }

  async listByChat(chatId: string): Promise<ChatMessage[]> {
    return [...(this.messagesByChat.get(chatId)?.values() ?? [])].sort(
      (left, right) => left.id - right.id,
    );
  }
}

export class InMemorySummariesRepo {
  private readonly runsByCommand = new Map<string, SummaryRun>();

  async findLastRun(chatId: string): Promise<SummaryRun | undefined> {
    return [...this.runsByCommand.values()]
      .filter((run) => run.chatId === chatId && run.status === "ok")
      .sort((left, right) => right.createdAt - left.createdAt)
      .at(0);
  }

  async saveRun(run: SummaryRun): Promise<void> {
    this.runsByCommand.set(`${run.chatId}:${run.commandMessageId}`, { ...run });
  }
}
