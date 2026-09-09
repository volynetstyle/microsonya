import type {
  ProgressiveTransport,
  TelegramApi,
} from "./ProgressiveTransport.js";
import { messageIdFrom } from "./utils.js";

export class PrivateDraftTransport implements ProgressiveTransport {
  private committedMessageId?: number;

  constructor(
    private readonly telegram: TelegramApi,
    private readonly chatId: string,
    private readonly draftId: number,
  ) {}

  get finalMessageId(): number | undefined {
    return this.committedMessageId;
  }

  async begin(): Promise<void> {
    await this.writeDraft("");
  }

  async update(text: string): Promise<void> {
    await this.writeDraft(text);
  }

  async commit(text: string): Promise<void> {
    this.committedMessageId = messageIdFrom(
      await this.telegram.call("sendMessage", {
        chat_id: this.chatId,
        text,
      }),
    );
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
