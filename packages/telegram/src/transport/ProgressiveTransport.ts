export interface ProgressiveTransport {
  readonly finalMessageId?: number;

  begin(): Promise<void>;
  update(text: string): Promise<void>;
  commit(text: string): Promise<void>;
  fail(): Promise<void>;
}

export interface TelegramApi {
  call(
    method: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}

export interface EditableMessageTarget {
  readonly chatId: string;
  readonly commandMessageId?: number;
  readonly messageThreadId?: number;
}
