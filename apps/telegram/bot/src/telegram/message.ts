import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  type ChatMessage,
} from "@microsonya/shared";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  type?: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramForwardOrigin = {
  type: string;
  date?: number;
  sender_user?: TelegramUser;
  sender_user_name?: string;
  sender_chat?: TelegramChat;
  chat?: TelegramChat;
  message_id?: number;
};

type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
};

export type TelegramMessageLike = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: { message_id: number };
  forward_origin?: TelegramForwardOrigin;
  forward_date?: number;
  forward_from?: TelegramUser;
  forward_sender_name?: string;
  forward_from_chat?: TelegramChat;
  photo?: unknown;
  voice?: unknown;
  sticker?: unknown;
  entities?: TelegramMessageEntity[];
  message_thread_id?: number;
};

export type TelegramMessageMappingOptions = {
  /** Excludes this bot's own derived replies from future source evidence. */
  selfAuthorId?: string;
};

/** Converts one Telegram payload into canonical text conversation data. */
export function fromTelegram(
  message: TelegramMessageLike,
  options: TelegramMessageMappingOptions = {},
): ChatMessage | undefined {
  if (isTelegramControlMessage(message)) {
    return undefined;
  }

  const source = toMessageSource(message);
  if (source.authorId === options.selfAuthorId) return undefined;
  const text = message.text ?? message.caption;

  if (text === undefined || text.trim() === "") {
    return undefined;
  }

  const author = Object.freeze({
    id: asAuthorId(source.authorId),
    label: source.authorName,
  });

  return Object.freeze({
    id: asMessageId(message.message_id),
    chatId: asChatId(String(message.chat.id)),
    author,
    // Destination time defines the observable chat chronology. A forwarded
    // origin's historical date must not move a newly observed message back in W.
    time: asTimestampMs(message.date * 1000),
    parentId:
      message.reply_to_message === undefined
        ? null
        : asMessageId(message.reply_to_message.message_id),
    text,
  });
}

/** Telegram commands are control input, including commands in imported history. */
export function isTelegramControlMessage(
  message: TelegramMessageLike,
): boolean {
  return Boolean(
    message.entities?.some(
      (entity) => entity.type === "bot_command" && entity.offset === 0,
    ),
  );
}

export function isForwardedMessage(message: TelegramMessageLike): boolean {
  return Boolean(
    message.forward_origin ??
    message.forward_date ??
    message.forward_from ??
    message.forward_sender_name ??
    message.forward_from_chat,
  );
}

function toMessageSource(message: TelegramMessageLike): {
  authorId: string;
  authorName: string;
} {
  const origin = message.forward_origin;

  if (origin) {
    return toForwardOriginAuthor(origin);
  }

  if (message.forward_from) {
    return {
      authorId: String(message.forward_from.id),
      authorName: formatUserName(message.forward_from),
    };
  }

  if (message.forward_sender_name) {
    return {
      authorId: message.forward_sender_name,
      authorName: message.forward_sender_name,
    };
  }

  if (message.forward_from_chat) {
    return {
      authorId: String(message.forward_from_chat.id),
      authorName: formatChatName(message.forward_from_chat),
    };
  }

  const from = message.from;

  return {
    authorId: from ? String(from.id) : String(message.chat.id),
    authorName: from ? formatUserName(from) : formatChatName(message.chat),
  };
}

function toForwardOriginAuthor(origin: TelegramForwardOrigin): {
  authorId: string;
  authorName: string;
} {
  switch (origin.type) {
    case "user":
      if (!origin.sender_user) {
        break;
      }
      return {
        authorId: String(origin.sender_user.id),
        authorName: formatUserName(origin.sender_user),
      };
    case "hidden_user":
      if (!origin.sender_user_name) {
        break;
      }
      return {
        authorId: origin.sender_user_name,
        authorName: origin.sender_user_name,
      };
    case "chat":
      if (!origin.sender_chat) {
        break;
      }
      return {
        authorId: String(origin.sender_chat.id),
        authorName: formatChatName(origin.sender_chat),
      };
    case "channel":
      if (!origin.chat) {
        break;
      }
      return {
        authorId: String(origin.chat.id),
        authorName: formatChatName(origin.chat),
      };
    default:
      return {
        authorId: "forwarded",
        authorName: "Forwarded",
      };
  }

  return {
    authorId: "forwarded",
    authorName: "Forwarded",
  };
}

function formatUserName(user: TelegramUser): string {
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.username ||
    String(user.id)
  );
}

function formatChatName(chat: TelegramChat): string {
  return (
    [chat.title, chat.first_name, chat.last_name, chat.username]
      .filter(Boolean)
      .join(" ") || String(chat.id)
  );
}
