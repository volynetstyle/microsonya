import type {
  AuthorId,
  ChatMessage,
  ConversationWindow,
} from "@microsonya/shared";

export interface ConversationTurn {
  readonly authorId: AuthorId;
  readonly messages: readonly ChatMessage[];
}

export interface StructuralAnalysis {
  readonly turnCount: number;
  readonly authorSwitches: number;
  readonly reactionLikeCount: number;
  readonly emojiOnlyCount: number;
  readonly hasExternalReply: boolean;
  readonly hasPotentialAnaphora: boolean;
  readonly structurallyCompact: boolean;
}

/** Derives adjacent logical turns without filtering or changing W. */
export function deriveTurns(
  window: ConversationWindow,
): readonly ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  for (const message of window.messages) {
    const previous = turns.at(-1);
    if (previous?.authorId === message.author.id) {
      turns[turns.length - 1] = Object.freeze({
        authorId: previous.authorId,
        messages: Object.freeze([...previous.messages, message]),
      });
      continue;
    }

    turns.push(
      Object.freeze({
        authorId: message.author.id,
        messages: Object.freeze([message]),
      }),
    );
  }

  return Object.freeze(turns);
}

/** Computes deterministic evidence while leaving W byte-for-byte unchanged. */
export function analyzeStructure(
  window: ConversationWindow,
): StructuralAnalysis {
  const ids = new Set(window.messages.map((message) => message.id));
  const turns = deriveTurns(window);
  const characterCount = window.messages.reduce(
    (sum, message) => sum + message.text.length,
    0,
  );

  return Object.freeze({
    turnCount: turns.length,
    authorSwitches: Math.max(0, turns.length - 1),
    reactionLikeCount: window.messages.filter((message) =>
      isReactionLike(message.text),
    ).length,
    emojiOnlyCount: window.messages.filter((message) =>
      isEmojiOnly(message.text),
    ).length,
    hasExternalReply: window.messages.some(
      (message) => message.parentId !== null && !ids.has(message.parentId),
    ),
    hasPotentialAnaphora: window.messages.some((message) =>
      POTENTIAL_ANAPHORA.test(message.text),
    ),
    // This is evidence only. No policy decision is derived from this threshold.
    structurallyCompact: window.messages.length <= 3 && characterCount <= 280,
  });
}

const POTENTIAL_ANAPHORA =
  /\b(?:he|she|they|it|this|that|those|these|him|her|them|он|она|они|это|этот|тот|він|вона|вони|це|цей|той)\b/iu;

const REACTION_WORDS = new Set([
  "aha",
  "cool",
  "got it",
  "haha",
  "lol",
  "nice",
  "ok",
  "okay",
  "thanks",
  "wow",
  "ага",
  "ахах",
  "ахаха",
  "вау",
  "дякую",
  "жесть",
  "зрозуміло",
  "клас",
  "ок",
  "спасибо",
  "понял",
]);

function isReactionLike(text: string): boolean {
  const normalized = text
    .trim()
    .toLocaleLowerCase()
    .replace(/[!.?…]+$/u, "");
  return (
    normalized.length > 0 &&
    (REACTION_WORDS.has(normalized) || isEmojiOnly(normalized))
  );
}

function isEmojiOnly(text: string): boolean {
  const withoutEmojiOrFormatting = text.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\s!,.?…]+/gu,
    "",
  );
  return text.trim().length > 0 && withoutEmojiOrFormatting.length === 0;
}
