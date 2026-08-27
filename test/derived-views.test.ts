import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
  type AuthorId,
  type ChatMessage,
  type MessageId,
} from "../packages/shared/src/index.js";
import {
  analyzeStructure,
  deriveTurns,
  encodePipeWindow,
} from "../packages/summarize/src/index.js";

describe("derived conversation views", () => {
  it("groups adjacent turns by author identity rather than display label", () => {
    const authorA = asAuthorId("author-a");
    const authorB = asAuthorId("author-b");
    const window = fixtureWindow(authorA, authorB);

    const turns = deriveTurns(window);

    expect(turns.map((turn) => turn.authorId)).toEqual([
      authorA,
      authorB,
      authorA,
    ]);
    expect(turns.map((turn) => turn.messages.length)).toEqual([2, 2, 1]);
    // Same id with a changed label stays in one turn.
    expect(turns[0]!.messages.map((message) => message.author.label)).toEqual([
      "Vlad",
      "Vladimir",
    ]);
    // The same label with a different id begins a new turn.
    expect(turns[1]!.messages[0]!.author.label).toBe("Vlad");
    expect(turns[0]!.messages[0]).toBe(window.messages[0]);
    expect(Object.isFrozen(turns)).toBe(true);
    expect(turns.every(Object.isFrozen)).toBe(true);
    expect(turns.every((turn) => Object.isFrozen(turn.messages))).toBe(true);
  });

  it("detects an external reply without mutating or replacing W", () => {
    const window = fixtureWindow(
      asAuthorId("author-a"),
      asAuthorId("author-b"),
    );
    const messagesReference = window.messages;
    const messageReferences = [...window.messages];
    const before = encodePipeWindow(window);

    const turns = deriveTurns(window);
    const analysis = analyzeStructure(window);

    expect(analysis.hasExternalReply).toBe(true);
    expect(Object.isFrozen(analysis)).toBe(true);
    expect(window.messages).toBe(messagesReference);
    expect([...window.messages]).toEqual(messageReferences);
    expect(encodePipeWindow(window)).toBe(before);
    expect(turns.flatMap((turn) => turn.messages)).toEqual(messageReferences);
  });
});

function fixtureWindow(authorA: AuthorId, authorB: AuthorId) {
  const chatId = asChatId("chat-views");

  return createConversationWindow([
    message(1, 1_000, authorA, "Vlad", asMessageId(99), chatId),
    message(2, 2_000, authorA, "Vladimir", asMessageId(1), chatId),
    message(3, 3_000, authorB, "Vlad", asMessageId(2), chatId),
    message(4, 4_000, authorB, "Vlad", null, chatId),
    message(5, 5_000, authorA, "Vlad", null, chatId),
  ]);
}

function message(
  id: number,
  time: number,
  authorId: AuthorId,
  authorLabel: string,
  parentId: MessageId | null,
  chatId: ReturnType<typeof asChatId>,
): ChatMessage {
  return {
    id: asMessageId(id),
    chatId,
    author: { id: authorId, label: authorLabel },
    time: asTimestampMs(time),
    parentId,
    text: `Message ${id}`,
  };
}
