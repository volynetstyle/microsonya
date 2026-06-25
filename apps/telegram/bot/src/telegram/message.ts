import type { ChatMessage, MessageKind } from "@microsonya/shared";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
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
};

export function toChatMessage(message: TelegramMessageLike): ChatMessage {
  const source = getMessageSource(message);
  const text = message.text ?? message.caption ?? "";

  return {
    id: message.message_id,
    chatId: String(message.chat.id),
    date: source.date * 1000,
    authorId: source.authorId,
    authorName: source.authorName,
    text,
    replyToId: message.reply_to_message?.message_id,
    kind: getMessageKind(message),
    isCommand: !isForwardedMessage(message) && text.startsWith("/"),
  };
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

function getMessageSource(message: TelegramMessageLike): {
  date: number;
  authorId: string;
  authorName: string;
} {
  const origin = message.forward_origin;

  if (origin) {
    return {
      date: origin.date ?? message.date,
      ...getForwardOriginAuthor(origin),
    };
  }

  if (message.forward_from) {
    return {
      date: message.forward_date ?? message.date,
      authorId: String(message.forward_from.id),
      authorName: formatUserName(message.forward_from),
    };
  }

  if (message.forward_sender_name) {
    return {
      date: message.forward_date ?? message.date,
      authorId: message.forward_sender_name,
      authorName: message.forward_sender_name,
    };
  }

  if (message.forward_from_chat) {
    return {
      date: message.forward_date ?? message.date,
      authorId: String(message.forward_from_chat.id),
      authorName: formatChatName(message.forward_from_chat),
    };
  }

  const from = message.from;

  return {
    date: message.date,
    authorId: from ? String(from.id) : String(message.chat.id),
    authorName: from ? formatUserName(from) : formatChatName(message.chat),
  };
}

function getForwardOriginAuthor(origin: TelegramForwardOrigin): {
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

function getMessageKind(message: TelegramMessageLike): MessageKind {
  if (message.text || message.caption) {
    return "text";
  }

  if (message.photo) {
    return "photo";
  }

  if (message.voice) {
    return "voice";
  }

  if (message.sticker) {
    return "sticker";
  }

  return "service";
}

function formatUserName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id);
}

function formatChatName(chat: TelegramChat): string {
  return [chat.title, chat.first_name, chat.last_name, chat.username].filter(Boolean).join(" ") || String(chat.id);
}
