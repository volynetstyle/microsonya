export const DISCOURSE_PROMPT_VERSION = "v4";

export function buildDiscoursePrompt(
  serializedMessages: string,
  representation: string,
  languageGuide?: string,
): string {
  const sections = [
    "Reconstruct a Telegram conversation as normalized discourse events. Do not write a summary and do not output decisions or openQuestions.",
    "Preserve speaker attribution, explicit reply edges, disagreement, commitment, literalness, and direct evidence message IDs.",
    "Return JSON only with a title and normalized discourse events.",
    `Input representation: ${representation}`,
  ];
  if (languageGuide) sections.push("Input language reference:", languageGuide);
  sections.push("Messages:", serializedMessages);
  return sections.join("\n\n");
}
