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
          fragments: [
            {
              text: "Карінка повідомила, що квартира коштує 1700 злотих, а комуналка — десь 500.",
              evidence: [41],
              subjects: [{ author: "Карінка", evidence: [41] }],
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
          fragments: [
            {
              text: "На балконі планують вирощувати помідори.",
              evidence: [42],
              subjects: [{ author: "Друг", evidence: [42] }],
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
          fragments: [
            {
              text: "Ілон назвав ціну квартири.",
              evidence: [41],
              subjects: [{ author: "Ілон", evidence: [41] }],
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
          fragments: [
            {
              text: "Квартира коштує 17 злотих.",
              evidence: [41],
              subjects: [{ author: "Карінка", evidence: [41] }],
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

  it("rejects an independent summary field even when fragments are grounded", () => {
    expect(() =>
      acceptSummaryCandidate(
        Object.assign(
          {
            fragments: [
              {
                text: "Квартира коштує 1700 злотих.",
                evidence: [41],
                subjects: [{ author: "Карінка", evidence: [41] }],
              },
            ],
          },
          { summary: "Unverified extra prose" },
        ),
        window,
        roles,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "MODEL_OUTPUT_SCHEMA_MISMATCH",
      }),
    );
  });
});
