import type { Message, MessageEntity } from "@telegraf/types";
import {
  asChatId,
  asMessageId,
  asTimestampMs,
  type SummaryCommand,
} from "@microsonya/shared";
import { APP_COMMAND_NAME } from "./appCommand.js";

export const SUMMARY_COMMAND_NAME = "summary";
const MAX_REQUESTED_COUNT = 128;

export const telegramCommands = [
  {
    command: SUMMARY_COMMAND_NAME,
    description: "Summarize recent messages",
  },
  {
    command: APP_COMMAND_NAME,
    description: "Open Microsonya",
    is_ephemeral: true,
  },
];

/** The exact Telegram Bot API projection consumed by the command adapter. */
export type TelegramSummaryCommandMessage = Pick<
  Message.ServiceMessage,
  "message_id" | "date"
> &
  Partial<Pick<Message.TextMessage, "text">> & {
    readonly entities?: readonly Pick<
      MessageEntity,
      "type" | "offset" | "length"
    >[];
    readonly chat: Pick<Message.TextMessage["chat"], "id">;
    readonly forward_origin?: unknown;
    readonly forward_date?: number;
    readonly forward_from?: unknown;
    readonly forward_sender_name?: string;
    readonly forward_from_chat?: unknown;
  };

export function parseSummaryCommand<T extends TelegramSummaryCommandMessage>(
  message: T,
  botUsername?: string,
): SummaryCommand | undefined {
  if (!message.text || isForwardedMessage(message)) return undefined;

  const entity = message.entities?.find(
    ({ type, offset }) => type === "bot_command" && offset === 0,
  );
  if (!entity) return undefined;

  const command = parseBotCommand(
    message.text.slice(entity.offset, entity.offset + entity.length),
  );
  if (!command || command.name.toLowerCase() !== SUMMARY_COMMAND_NAME) {
    return undefined;
  }
  if (
    command.target !== undefined &&
    (botUsername === undefined ||
      command.target.toLowerCase() !== botUsername.toLowerCase())
  ) {
    return undefined;
  }

  const args = parseSummaryArgs(
    message.text.slice(entity.offset + entity.length).trim(),
  );
  if (!args) return undefined;

  return {
    chatId: asChatId(String(message.chat.id)),
    commandMessageId: asMessageId(message.message_id),
    date: asTimestampMs(message.date * 1_000),
    ...args,
  };
}

/**
 * Validates only the Telegram projection consumed by `/summary`, then returns
 * a domain command. Bot API types remain compile-time documentation, never a
 * claim that untrusted JSON has already been validated.
 */
export function parseSummaryCommandUpdate(
  input: unknown,
  botUsername?: string,
): SummaryCommand | undefined {
  const update = asRecord(input);
  if (update === undefined || !Number.isSafeInteger(update.update_id)) {
    return undefined;
  }

  const message = asRecord(update.message);
  const chat = message === undefined ? undefined : asRecord(message.chat);
  const messageId =
    message === undefined ? undefined : asSafeInteger(message.message_id);
  const date = message === undefined ? undefined : asSafeInteger(message.date);
  const chatId = chat === undefined ? undefined : asChatIdentifier(chat.id);
  if (
    message === undefined ||
    typeof message.text !== "string" ||
    messageId === undefined ||
    date === undefined ||
    chatId === undefined
  ) {
    return undefined;
  }

  const entities = parseCommandEntities(message.entities);
  if (message.entities !== undefined && entities === undefined) {
    return undefined;
  }

  return parseSummaryCommand(
    {
      message_id: messageId,
      date,
      text: message.text,
      chat: { id: chatId },
      entities,
      forward_origin: message.forward_origin,
      forward_date:
        typeof message.forward_date === "number"
          ? message.forward_date
          : undefined,
      forward_from: message.forward_from,
      forward_sender_name:
        typeof message.forward_sender_name === "string"
          ? message.forward_sender_name
          : undefined,
      forward_from_chat: message.forward_from_chat,
    },
    botUsername,
  );
}

export function parseSummaryArgs(
  raw: string,
): Pick<SummaryCommand, "mode" | "count"> | undefined {
  if (raw === "") return { mode: "recent" };
  if (raw === "today") return { mode: "today" };
  if (!/^\d+$/u.test(raw)) return undefined;

  const count = Number(raw);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_REQUESTED_COUNT
  ) {
    return undefined;
  }
  return { mode: "count", count };
}

function parseBotCommand(
  raw: string,
): { name: string; target?: string } | undefined {
  const match = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?$/iu.exec(raw);
  if (!match?.[1]) return undefined;
  return { name: match[1], target: match[2] };
}

function isForwardedMessage(message: TelegramSummaryCommandMessage): boolean {
  return (
    message.forward_origin !== undefined ||
    message.forward_date !== undefined ||
    message.forward_from !== undefined ||
    message.forward_sender_name !== undefined ||
    message.forward_from_chat !== undefined
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function asNonNegativeSafeInteger(value: unknown): number | undefined {
  const number = asSafeInteger(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function asChatIdentifier(value: unknown): number | undefined {
  return asSafeInteger(value);
}

function parseCommandEntities(
  value: unknown,
): TelegramSummaryCommandMessage["entities"] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;

  const entities: Array<
    NonNullable<TelegramSummaryCommandMessage["entities"]>[number]
  > = [];
  for (const candidate of value) {
    const entity = asRecord(candidate);
    const offset =
      entity === undefined
        ? undefined
        : asNonNegativeSafeInteger(entity.offset);
    const length =
      entity === undefined
        ? undefined
        : asNonNegativeSafeInteger(entity.length);
    if (
      entity === undefined ||
      typeof entity.type !== "string" ||
      offset === undefined ||
      length === undefined
    ) {
      return undefined;
    }
    entities.push({
      type: entity.type as MessageEntity["type"],
      offset,
      length,
    });
  }
  return entities;
}
