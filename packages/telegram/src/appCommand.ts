export const APP_COMMAND_NAME = "app";

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
  const update = asRecord(input);
  if (update === undefined || !Number.isSafeInteger(update.update_id)) {
    return undefined;
  }

  const message = asRecord(update.message);
  const chat = message === undefined ? undefined : asRecord(message.chat);
  const from = message === undefined ? undefined : asRecord(message.from);
  const chatId = chat === undefined ? undefined : asSafeInteger(chat.id);
  const userId =
    from === undefined ? undefined : asPositiveSafeInteger(from.id);
  const chatType = chat === undefined ? undefined : asChatType(chat.type);
  if (
    message === undefined ||
    typeof message.text !== "string" ||
    chatId === undefined ||
    userId === undefined ||
    chatType === undefined ||
    isForwardedMessage(message)
  ) {
    return undefined;
  }

  const commandEntity = parseCommandEntity(message.entities);
  if (commandEntity === undefined) return undefined;

  const rawCommand = message.text.slice(
    commandEntity.offset,
    commandEntity.offset + commandEntity.length,
  );
  const command = parseBotCommand(rawCommand);
  if (
    command === undefined ||
    command.name.toLowerCase() !== APP_COMMAND_NAME ||
    message.text.slice(commandEntity.offset + commandEntity.length).trim() !==
      ""
  ) {
    return undefined;
  }
  if (
    command.target !== undefined &&
    (botUsername === undefined ||
      command.target.toLowerCase() !== botUsername.toLowerCase())
  ) {
    return undefined;
  }

  const ephemeralMessageId = asNonNegativeSafeInteger(
    message.ephemeral_message_id,
  );
  if (chatType !== "private" && ephemeralMessageId === undefined) {
    return undefined;
  }

  return Object.freeze({
    chatId: String(chatId),
    userId,
    chatType,
    ...(ephemeralMessageId === undefined ? {} : { ephemeralMessageId }),
  });
}

export function createAppLauncherMessage(
  command: TelegramAppCommand,
  botUsername: string,
): Readonly<Record<string, unknown>> {
  const username = botUsername.replace(/^@/u, "");
  if (!/^[a-z0-9_]+$/iu.test(username)) {
    throw new TypeError("Invalid Telegram bot username.");
  }

  return Object.freeze({
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
  });
}

function parseCommandEntity(
  value: unknown,
): { readonly offset: number; readonly length: number } | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const entity = asRecord(candidate);
    const offset = asNonNegativeSafeInteger(entity?.offset);
    const length = asPositiveSafeInteger(entity?.length);
    if (
      entity?.type === "bot_command" &&
      offset === 0 &&
      length !== undefined
    ) {
      return { offset, length };
    }
  }
  return undefined;
}

function parseBotCommand(
  raw: string,
): { readonly name: string; readonly target?: string } | undefined {
  const match = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?$/iu.exec(raw);
  if (!match?.[1]) return undefined;
  return { name: match[1], target: match[2] };
}

function isForwardedMessage(message: Record<string, unknown>): boolean {
  return (
    message.forward_origin !== undefined ||
    message.forward_date !== undefined ||
    message.forward_from !== undefined ||
    message.forward_sender_name !== undefined ||
    message.forward_from_chat !== undefined
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function asPositiveSafeInteger(value: unknown): number | undefined {
  const number = asSafeInteger(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function asNonNegativeSafeInteger(value: unknown): number | undefined {
  const number = asSafeInteger(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function asChatType(
  value: unknown,
): TelegramAppCommand["chatType"] | undefined {
  return value === "private" || value === "group" || value === "supergroup"
    ? value
    : undefined;
}
