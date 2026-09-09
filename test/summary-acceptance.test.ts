import { describe, expect, it } from "vitest";
import {
  asAuthorId,
  asChatId,
  asMessageId,
  asTimestampMs,
  createConversationWindow,
} from "../packages/shared/src/index.js";
import {
  SummaryAcceptanceError,
  acceptSummaryCandidate,
} from "../packages/summarize/src/index.js";

describe("summary candidate acceptance", () => {
  const window = createConversationWindow([
    {
      id: asMessageId(41),
      chatId: asChatId("chat"),
      author: { id: asAuthorId("karinka"), label: "Карінка" },
      time: asTimestampMs(1),
      parentId: null,
      text: "Квартира коштує 1700 злотих, комуналка десь 500.",
    },
    {
      id: asMessageId(42),
      chatId: asChatId("chat"),
      author: { id: asAuthorId("friend"), label: "Друг" },
      time: asTimestampMs(2),
      parentId: null,
      text: "Балкон уже готова грядка, вайб, що там будуть помідори.",
    },
  ]);
  const roles = [
    { message: window.messages[0]!, role: "eligible" as const },
    { message: window.messages[1]!, role: "context" as const },
  ];

  it("accepts ordered claims grounded in eligible evidence", () => {
    expect(
      acceptSummaryCandidate(
        {
          summary:
            "Карінка повідомила, що квартира коштує 1700 злотих, а комуналка — десь 500.",
          claims: [
            {
              text: "Карінка повідомила, що квартира коштує 1700 злотих, а комуналка — десь 500.",
              evidence: [41],
              kind: "report",
              author: "Карінка",
            },
          ],
        },
        window,
        roles,
      ),
    ).toBe(
      "Карінка повідомила, що квартира коштує 1700 злотих, а комуналка — десь 500.",
    );
  });

  it("rejects context-only evidence", () => {
    expect(() =>
      acceptSummaryCandidate(
        {
          summary: "На балконі планують вирощувати помідори.",
          claims: [
            {
              text: "На балконі планують вирощувати помідори.",
              evidence: [42],
              kind: "plan",
              author: "Друг",
            },
          ],
        },
        window,
        roles,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SummaryAcceptanceError>>({
        code: "PROVENANCE",
      }),
    );
  });

  it("rejects an author absent from the cited messages", () => {
    expect(() =>
      acceptSummaryCandidate(
        {
          summary: "Ілон назвав ціну квартири.",
          claims: [
            {
              text: "Ілон назвав ціну квартири.",
              evidence: [41],
              kind: "report",
              author: "Ілон",
            },
          ],
        },
        window,
        roles,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SummaryAcceptanceError>>({
        code: "PROVENANCE",
      }),
    );
  });

  it("rejects unsupported numeric anchors", () => {
    expect(() =>
      acceptSummaryCandidate(
        {
          summary: "Квартира коштує 17 злотих.",
          claims: [
            {
              text: "Квартира коштує 17 злотих.",
              evidence: [41],
              kind: "report",
              author: "Карінка",
            },
          ],
        },
        window,
        roles,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SummaryAcceptanceError>>({
        code: "FACT_INVENTION",
      }),
    );
  });

  it("rejects canonical prose not covered by ordered claims", () => {
    expect(() =>
      acceptSummaryCandidate(
        {
          summary: "Квартира коштує 1700 злотих. Це остаточна ціна.",
          claims: [
            {
              text: "Квартира коштує 1700 злотих.",
              evidence: [41],
              kind: "report",
              author: "Карінка",
            },
          ],
        },
        window,
        roles,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SummaryAcceptanceError>>({
        code: "UNSUPPORTED_SUMMARY_TEXT",
      }),
    );
  });
});
