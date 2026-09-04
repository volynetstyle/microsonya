import { asParticipantId, type SummaryInline } from "@microsonya/shared";
import { describe, expect, it } from "vitest";
import {
  parseSummaryInline,
  renderShareableSummaryInline,
  renderSummaryInline,
  resolveParticipantLabel,
  type WmaParticipant,
} from "../src/wma/src-api/identity-presentation.js";
import { wmaCachePolicy } from "../src/wma/src-api/edge-cache.js";

const karina: WmaParticipant = {
  id: "participant_17",
  sourceLabel: "Karina",
};
const inline: readonly SummaryInline[] = Object.freeze([
  { type: "participant", participantId: asParticipantId("participant_17") },
  { type: "text", value: " повідомила про затримку замовлення." },
]);

describe("viewer-scoped participant presentation", () => {
  it("resolves aliases separately for A, B, and a viewer with no alias", () => {
    expect(
      resolveParticipantLabel(karina, new Map([[karina.id, "Карінка"]])),
    ).toBe("Карінка");
    expect(
      resolveParticipantLabel(karina, new Map([[karina.id, "Каріна"]])),
    ).toBe("Каріна");
    expect(resolveParticipantLabel(karina, new Map())).toBe("Karina");
  });

  it("renders the same immutable canonical references per viewer", () => {
    const participants = new Map([[karina.id, karina]]);
    const original = JSON.stringify(inline);

    expect(
      renderSummaryInline(
        inline,
        participants,
        new Map([[karina.id, "Карінка"]]),
      ),
    ).toBe("Карінка повідомила про затримку замовлення.");
    expect(
      renderSummaryInline(
        inline,
        participants,
        new Map([[karina.id, "Каріна"]]),
      ),
    ).toBe("Каріна повідомила про затримку замовлення.");
    // Telegram/shared output never supplies a private alias map.
    expect(renderSummaryInline(inline, participants, new Map())).toBe(
      "Karina повідомила про затримку замовлення.",
    );
    expect(JSON.stringify(inline)).toBe(original);
  });

  it("accepts only explicit persisted participant references", () => {
    expect(
      parseSummaryInline([
        { type: "participant", participantId: "participant_17" },
        { type: "text", value: " написала." },
      ]),
    ).toEqual([
      { type: "participant", participantId: "participant_17" },
      { type: "text", value: " написала." },
    ]);
    expect(parseSummaryInline([{ type: "text", value: 42 }])).toBeUndefined();
  });

  it("rerenders canonical refs for sharing instead of copying viewer text", () => {
    const participants = new Map([[karina.id, karina]]);
    const viewerText = renderSummaryInline(
      inline,
      participants,
      new Map([[karina.id, "Карінка"]]),
    );
    const sharedText = renderShareableSummaryInline(inline, participants, {
      kind: "public",
    });

    expect(viewerText).toContain("Карінка");
    expect(sharedText).toContain("Karina");
    expect(sharedText).not.toContain("Карінка");
  });

  it("does not edge-cache alias-rendered WMA resources", () => {
    expect(
      wmaCachePolicy(
        new URL("https://wma.test/api/wma/chat-overview?chatRef=chat-1"),
      ),
    ).toBeUndefined();
    expect(
      wmaCachePolicy(
        new URL(
          "https://wma.test/api/wma/summary-detail?chatRef=chat-1&summaryId=s-1",
        ),
      ),
    ).toBeUndefined();
  });
});
