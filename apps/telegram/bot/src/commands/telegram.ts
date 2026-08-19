import type { TelegramMessageLike } from "../telegram/message.js";

export type TelegramCommandInvocation = {
  chatId: string;
  messageId: number;
  date: number;
  name: string;
  args: readonly string[];
};

export function toCommandInvocation(
  message: TelegramMessageLike,
  botUsername?: string,
): TelegramCommandInvocation | undefined {
  const text = message.text;
  if (!text) return undefined;

  const entity = message.entities?.find(
    (candidate) => candidate.type === "bot_command" && candidate.offset === 0,
  );
  if (!entity) return undefined;

  // Bot API offsets are UTF-16 code units, matching String#slice.
  const rawCommand = text.slice(entity.offset, entity.offset + entity.length);
  const [name, target] = rawCommand.slice(1).split("@", 2);
  if (!name) return undefined;
  if (
    target !== undefined &&
    botUsername !== undefined &&
    target.toLowerCase() !== botUsername.toLowerCase()
  ) {
    return undefined;
  }

  const rest = text.slice(entity.offset + entity.length).trim();
  return {
    chatId: String(message.chat.id),
    messageId: message.message_id,
    date: message.date * 1000,
    name: name.toLowerCase(),
    args: rest === "" ? [] : rest.split(/\s+/u),
  };
}
