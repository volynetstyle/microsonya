import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
  type ChatId,
  type ChatMessage,
  type MessageId,
} from "../packages/shared/src/index.js";

describe("ConversationWindow", () => {
  it("defensively copies and deeply freezes canonical window data", () => {
    const author = { id: asAuthorId("author-1"), label: "Original author" };
    const sourceMessage = {
      id: asMessageId(1),
      chatId: asChatId("chat-1"),
      author,
      time: asTimestampMs(1_000),
      parentId: null,
      text: "Original text",
    };
    const sourceMessages: ChatMessage[] = [sourceMessage];

    const window = createConversationWindow(sourceMessages);

    expect(window.messages).not.toBe(sourceMessages);
    expect(window.messages[0]).not.toBe(sourceMessage);
    expect(window.messages[0]!.author).not.toBe(author);
    expect(Object.isFrozen(window)).toBe(true);
    expect(Object.isFrozen(window.messages)).toBe(true);
    expect(Object.isFrozen(window.messages[0])).toBe(true);
    expect(Object.isFrozen(window.messages[0]!.author)).toBe(true);

    author.label = "Mutated author";
    sourceMessage.text = "Mutated text";
    sourceMessages.push(
      message(2, 2_000, { text: "Added after construction" }),
    );

    expect(window.messages).toHaveLength(1);
    expect(window.messages[0]).toMatchObject({
      author: { id: "author-1", label: "Original author" },
      text: "Original text",
    });
  });

  it("preserves an explicit parent outside the visible window", () => {
    const externalParent = asMessageId(777);
    const window = createConversationWindow([
      message(10, 1_000, { parentId: externalParent }),
    ]);

    expect(window.messages[0]!.parentId).toBe(externalParent);
  });

  it.each([
    ["an empty window", () => createConversationWindow([]), /at least one/i],
    [
      "messages from different chats",
      () =>
        createConversationWindow([
          message(1, 1_000),
          message(2, 2_000, { chatId: asChatId("another-chat") }),
        ]),
      /different chat/i,
    ],
    [
      "duplicate message ids",
      () => createConversationWindow([message(1, 1_000), message(1, 2_000)]),
      /duplicate message id/i,
    ],
    [
      "decreasing timestamps",
      () => createConversationWindow([message(1, 2_000), message(2, 1_000)]),
      /chronological order/i,
    ],
    [
      "an invalid runtime parent",
      () =>
        createConversationWindow([
          {
            ...message(1, 1_000),
            parentId: undefined,
          } as unknown as ChatMessage,
        ]),
      /parent id/i,
    ],
    [
      "an invalid runtime author",
      () =>
        createConversationWindow([
          {
            ...message(1, 1_000),
            author: { id: asAuthorId("author-1"), label: " " },
          },
        ]),
      /author label/i,
    ],
  ] as const)("rejects %s", (_name, create, expected) => {
    expect(create).toThrow(expected);
  });
});

function message(
  id: number,
  time: number,
  overrides: {
    readonly chatId?: ChatId;
    readonly authorId?: string;
    readonly authorLabel?: string;
    readonly parentId?: MessageId | null;
    readonly text?: string;
  } = {},
): ChatMessage {
  return {
    id: asMessageId(id),
    chatId: overrides.chatId ?? asChatId("chat-1"),
    author: {
      id: asAuthorId(overrides.authorId ?? "author-1"),
      label: overrides.authorLabel ?? "Author",
    },
    time: asTimestampMs(time),
    parentId: overrides.parentId ?? null,
    text: overrides.text ?? `Message ${id}`,
  };
}
