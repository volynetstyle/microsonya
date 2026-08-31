/** Structural transport contract; kept local so Telegram does not own the renderer. */
export interface ProgressiveTransport {
  begin(): Promise<void>;
  update(text: string): Promise<void>;
  commit(text: string): Promise<void>;
  fail(): Promise<void>;
}

export interface TelegramApi {
  call(method: string, body: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export class TelegramPrivateDraftTransport implements ProgressiveTransport {
  private committedMessageId?: number;
  constructor(
    private readonly telegram: TelegramApi,
    private readonly chatId: string,
    private readonly draftId: number,
  ) {}

  async begin(): Promise<void> {
    await this.writeDraft("");
  }

  async update(text: string): Promise<void> {
    await this.writeDraft(text);
  }

  async commit(text: string): Promise<void> {
    this.committedMessageId = messageIdFrom(
      await this.telegram.call("sendMessage", { chat_id: this.chatId, text }),
    );
  }

  get messageId(): number | undefined {
    return this.committedMessageId;
  }

  async fail(): Promise<void> {
    await this.telegram.call("sendMessage", {
      chat_id: this.chatId,
      text: "Не вдалося завершити підсумок.",
    });
  }

  private async writeDraft(text: string): Promise<void> {
    await this.telegram.call("sendMessageDraft", {
      chat_id: this.chatId,
      draft_id: this.draftId,
      text,
      can_stop: false,
    });
  }
}

export interface EditableMessageTarget {
  readonly chatId: string;
  readonly commandMessageId: number;
  readonly messageThreadId?: number;
}

export class TelegramEditableMessageTransport implements ProgressiveTransport {
  private messageId?: number;

  constructor(
    private readonly telegram: TelegramApi,
    private readonly target: EditableMessageTarget,
  ) {}

  get committedMessageId(): number | undefined {
    return this.messageId;
  }

  async begin(): Promise<void> {
    await this.telegram.call("sendChatAction", {
      chat_id: this.target.chatId,
      action: "typing",
      ...(this.target.messageThreadId === undefined
        ? {}
        : { message_thread_id: this.target.messageThreadId }),
    });
  }

  async update(text: string): Promise<void> {
    const rendered = `${text} ▍`;
    if (this.messageId === undefined) {
      this.messageId = messageIdFrom(
        await this.telegram.call("sendMessage", {
          chat_id: this.target.chatId,
          text: rendered,
          reply_parameters: { message_id: this.target.commandMessageId },
          ...(this.target.messageThreadId === undefined
            ? {}
            : { message_thread_id: this.target.messageThreadId }),
        }),
      );
      return;
    }
    await this.edit(rendered);
  }

  async commit(text: string): Promise<void> {
    if (this.messageId === undefined) {
      this.messageId = messageIdFrom(
        await this.telegram.call("sendMessage", {
          chat_id: this.target.chatId,
          text,
          ...(this.target.messageThreadId === undefined
            ? {}
            : { message_thread_id: this.target.messageThreadId }),
        }),
      );
      return;
    }
    await this.edit(text);
  }

  async fail(): Promise<void> {
    const text = "Не вдалося завершити підсумок.";
    if (this.messageId === undefined) {
      await this.telegram.call("sendMessage", {
        chat_id: this.target.chatId,
        text,
      });
      return;
    }
    await this.edit(text);
  }

  private async edit(text: string): Promise<void> {
    await this.telegram.call("editMessageText", {
      chat_id: this.target.chatId,
      message_id: this.messageId,
      text,
    });
  }
}

function messageIdFrom(payload: unknown): number {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Telegram response has no message id.");
  }
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) {
    throw new TypeError("Telegram response has no message id.");
  }
  const messageId = (result as { message_id?: unknown }).message_id;
  if (!Number.isSafeInteger(messageId)) {
    throw new TypeError("Telegram response has no message id.");
  }
  return messageId as number;
}
