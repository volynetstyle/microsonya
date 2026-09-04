import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
} from "../packages/shared/src/index.js";
import {
  buildSummaryPlanMessages,
  encodePipeWindow,
} from "../packages/summarize/src/index.js";
import { parseTelegramChatMessageUpdate } from "../packages/telegram/src/index.js";

describe("provenance-aware and referent-safe summary contract", () => {
  it("preserves chat author separately from a clean forwarded source label", () => {
    const message = parseTelegramChatMessageUpdate({
      message: {
        message_id: 1,
        date: 1_800,
        text: "ДБР повідомило про справу",
        chat: { id: -42 },
        from: { id: 7, first_name: "Meleys", username: "meleys" },
        forward_origin: {
          type: "channel",
          chat: {
            id: -99,
            title: "Лачен пише",
            username: "lachentyt",
          },
        },
      },
    });

    expect(message?.author).toEqual({ id: "7", label: "Meleys" });
    expect(message?.contentSource).toEqual({
      kind: "channel",
      sourceId: "-99",
      label: "Лачен пише",
      username: "lachentyt",
    });
    expect(message?.author.label).not.toContain("meleys");
    expect(message?.contentSource?.label).not.toContain("lachentyt");
  });

  it("encodes author and source in independent PIPECHAT fields", () => {
    const message = parseTelegramChatMessageUpdate({
      message: {
        message_id: 1,
        date: 1_800,
        text: "Повідомлення",
        chat: { id: -42 },
        from: { id: 7, first_name: "Meleys" },
        forward_sender_name: "External source",
      },
    })!;
    const fields = encodePipeWindow(createConversationWindow([message])).split(
      "|",
    );
    expect(JSON.parse(fields[2]!)).toBe("@1 Meleys");
    expect(JSON.parse(fields[3]!)).toBe("$1 forwarded_user External source");
  });

  it("makes the two-deliveries, numeric, and durable-selection rules explicit", () => {
    const window = createConversationWindow([
      {
        id: asMessageId(1),
        chatId: asChatId("chat"),
        author: { id: asAuthorId("vlad"), label: "Vlad" },
        time: asTimestampMs(1_800_000),
        parentId: null,
        text: "Моя посилка третій день у дорозі.",
      },
      {
        id: asMessageId(2),
        chatId: asChatId("chat"),
        author: { id: asAuthorId("sonna"), label: "Sonna" },
        time: asTimestampMs(1_801_000),
        parentId: null,
        text: "Окреме замовлення MOYO досі комплектується.",
      },
    ]);
    const policy = buildSummaryPlanMessages(window)[0]!.content;

    expect(policy).toContain("Keep distinct shipments, orders, purchases");
    expect(policy).toContain("Adjacency is not linking");
    expect(policy).toContain("three days is duration");
    expect(policy).toContain("Omit jokes, wishes, reactions");
    expect(policy).toContain("reported or claimed, never established");
  });
});
