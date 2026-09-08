import { ConflatingWriter } from "./ConflatingWriter.js";
import type {
  EditableMessageTarget,
  ProgressiveTransport,
  TelegramApi,
} from "./ProgressiveTransport.js";
import { messageIdFrom } from "./utils.js";

export interface EditableMessagePolicy {
  readonly intervalMs: number;
  readonly slowRequestThresholdMs: number;
  readonly congestionCooldownMs: number;
}

export const GROUP_PROGRESSIVE_POLICY: EditableMessagePolicy = {
  intervalMs: 1_000,
  slowRequestThresholdMs: 1_500,
  congestionCooldownMs: 1_000,
};

export class EditableMessageTransport implements ProgressiveTransport {
  private messageId?: number;

  private readonly writer: ConflatingWriter<string>;

  constructor(
    private readonly telegram: TelegramApi,
    private readonly target: EditableMessageTarget,
    policy: EditableMessagePolicy = GROUP_PROGRESSIVE_POLICY,
  ) {
    this.writer = new ConflatingWriter((text) => this.write(text), {
      delayMs: () => policy.intervalMs,
      slowRequestThresholdMs: policy.slowRequestThresholdMs,
      congestionCooldownMs: policy.congestionCooldownMs,
    });
  }

  get finalMessageId(): number | undefined {
    return this.messageId;
  }

  async begin(): Promise<void> {
    await this.telegram.call("sendChatAction", {
      chat_id: this.target.chatId,
      action: "typing",
      ...(this.target.messageThreadId === undefined
        ? {}
        : {
            message_thread_id: this.target.messageThreadId,
          }),
    });
  }

  update(text: string): Promise<void> {
    this.writer.update(text);

    // update() means accepted by the progressive transport,
    // not physically delivered to Telegram.
    return Promise.resolve();
  }

  async commit(text: string): Promise<void> {
    await this.writer.finalize(text);
  }

  async fail(): Promise<void> {
    await this.writer.finalize("Не вдалося завершити підсумок.");
  }

  private async write(text: string): Promise<void> {
    if (this.messageId === undefined) {
      this.messageId = messageIdFrom(await this.send(text));
      return;
    }

    await this.edit(text);
  }

  private async send(text: string): Promise<unknown> {
    return this.telegram.call("sendMessage", {
      chat_id: this.target.chatId,
      text,
      ...(this.target.commandMessageId === undefined
        ? {}
        : {
            reply_parameters: {
              message_id: this.target.commandMessageId,
            },
          }),
      ...(this.target.messageThreadId === undefined
        ? {}
        : {
            message_thread_id: this.target.messageThreadId,
          }),
    });
  }

  private async edit(text: string): Promise<void> {
    await this.telegram.call("editMessageText", {
      chat_id: this.target.chatId,
      message_id: this.messageId,
      text,
    });
  }
}
