import { expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
  type ChatId,
} from "../packages/shared/src/index.js";
import { encodePipeWindow } from "../packages/summarize/src/index.js";

it("keeps model inputs and branded identities distinct at compile time", () => {
  const window = createConversationWindow([
    {
      id: asMessageId(1),
      chatId: asChatId("chat"),
      author: { id: asAuthorId("author"), label: "Author" },
      time: asTimestampMs(1_000),
      parentId: null,
      text: "Message",
    },
  ]);

  expect(encodePipeWindow(window)).toContain("#1|^0|");

  if (false) {
    // @ts-expect-error PIPECHAT accepts W, never a raw message array.
    encodePipeWindow(window.messages);

    // @ts-expect-error AuthorId and ChatId are deliberately not interchangeable.
    const chatId: ChatId = window.messages[0]!.author.id;
    void chatId;

    // @ts-expect-error Canonical windows are immutable views.
    window.messages[0] = window.messages[0]!;

    // @ts-expect-error Nested author identity is immutable as well.
    window.messages[0]!.author.id = asAuthorId("replacement");
  }
});
