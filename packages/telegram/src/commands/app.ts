import { parseTelegramCommand } from "../telegram.command.js";
import { APP_COMMAND } from "../telegram.commands.js";
import { parseTelegramMessageUpdate } from "../telegram.message.js";

export interface TelegramAppCommand {
  readonly chatId: string;
  readonly userId: number;
  readonly chatType: "private" | "group" | "supergroup";
  readonly ephemeralMessageId?: number;
}

/**
 * Validates the Telegram update projection consumed by `/app`.
 *
 * Group commands fail closed unless Telegram marked the incoming command as
 * ephemeral. This prevents an older or incorrectly registered client command
 * from producing a launcher that is visible to the whole chat.
 */
export function parseAppCommandUpdate(
  input: unknown,
  botUsername?: string,
): TelegramAppCommand | undefined {
  const message = parseTelegramMessageUpdate(input);
  if (message === undefined) return undefined;
  const command = parseTelegramCommand(message, botUsername);
  if (
    command === undefined ||
    command.name !== APP_COMMAND.command ||
    command.args !== "" ||
    message.chatType === "channel" ||
    message.senderUserId === undefined
  ) {
    return undefined;
  }
  if (
    message.chatType !== "private" &&
    message.ephemeralMessageId === undefined
  ) {
    return undefined;
  }
  return {
    chatId: message.chatId,
    userId: message.senderUserId,
    chatType: message.chatType,
    ...(message.ephemeralMessageId === undefined
      ? {}
      : { ephemeralMessageId: message.ephemeralMessageId }),
  };
}

export function createAppLauncherMessage(
  command: TelegramAppCommand,
  botUsername: string,
): Readonly<Record<string, unknown>> {
  const username = botUsername.replace(/^@/u, "");
  if (!/^[a-z0-9_]+$/iu.test(username)) {
    throw new TypeError("Invalid Telegram bot username.");
  }

  return {
    chat_id: command.chatId,
    text: "Microsonya готова до роботи.",
    ...(command.ephemeralMessageId === undefined
      ? {}
      : {
          ephemeral_message_parameters: {
            receiver_user_id: command.userId,
          },
          reply_parameters: {
            ephemeral_message_id: command.ephemeralMessageId,
          },
        }),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Відкрити Microsonya",
            url: `https://t.me/${username}?startapp`,
          },
        ],
      ],
    },
  };
}
