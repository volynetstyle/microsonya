import { asParticipantId, type SummaryInline } from "@microsonya/shared";

/** An opaque WMA participant identity and its public Telegram profile label. */
export type WmaParticipant = Readonly<{
  id: string;
  sourceLabel: string;
}>;

/**
 * Resolve identity only at a private presentation boundary. The map is loaded
 * for one authenticated viewer, so no other viewer's aliases can influence it.
 */
export function resolveParticipantLabel(
  participant: WmaParticipant,
  aliases: ReadonlyMap<string, string>,
): string {
  return aliases.get(participant.id) ?? participant.sourceLabel;
}

/**
 * Render explicit stored references. This deliberately never searches or
 * replaces natural-language text, so equal names and inflected prose cannot
 * cause a cross-participant replacement.
 */
export function renderSummaryInline(
  inline: readonly SummaryInline[],
  participants: ReadonlyMap<string, WmaParticipant>,
  aliases: ReadonlyMap<string, string>,
): string {
  return inline
    .map((part) => {
      if (part.type === "text") return part.value;
      const participant = participants.get(part.participantId);
      if (participant === undefined) {
        throw new TypeError("Summary references an unavailable participant.");
      }
      return resolveParticipantLabel(participant, aliases);
    })
    .join("");
}

/** Parse only the small persisted representation accepted by the renderer. */
export function parseSummaryInline(
  value: unknown,
): readonly SummaryInline[] | undefined {
  if (!Array.isArray(value)) return;
  const inline: SummaryInline[] = [];
  for (const part of value) {
    if (typeof part !== "object" || part === null) return;
    const candidate = part as {
      type?: unknown;
      value?: unknown;
      participantId?: unknown;
    };
    if (candidate.type === "text" && typeof candidate.value === "string") {
      inline.push({ type: "text", value: candidate.value });
    } else if (
      candidate.type === "participant" &&
      typeof candidate.participantId === "string" &&
      candidate.participantId.length > 0
    ) {
      inline.push({
        type: "participant",
        participantId: asParticipantId(candidate.participantId),
      });
    } else {
      return;
    }
  }
  return Object.freeze(inline);
}
