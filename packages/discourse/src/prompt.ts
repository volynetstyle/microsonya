export const DISCOURSE_PROMPT_VERSION = "v4";

export function buildDiscoursePrompt(
  serializedMessages: string,
  representation: string,
  languageGuide?: string,
): string {
  const sections = [
    "Reconstruct a Telegram conversation as normalized discourse events. Do not write a summary and do not output decisions or openQuestions.",
    "Create event ids from the primary evidence message id: m17 for message 17. Use suffixes only when one message contains multiple independent propositions (m17a, m17b).",
    "Use orthogonal properties. speechAct describes conversational function; literalness describes framing; commitment describes actor commitment; epistemicStatus describes whether the proposition is merely claimed, accepted, rejected, or uncertain.",
    "commitment=explicit only when the evidence clearly commits an identifiable actor to an action. A suggestion, preference, prediction, joke, analogy, or isolated first-person opinion is never explicit commitment.",
    "settled=true only when the conversation presents the action as selected, approved, completed, or otherwise settled. Lack of disagreement is not settlement.",
    "Set action to a concise action phrase only when an actionable actor/action exists; otherwise null. Never infer an action from a punchline or analogy.",
    'For an answer, correction, support, or opposition, refersTo must contain the target event id. A later answer to m10 uses refersTo:["m10"].',
    "Honor explicit reply edges: when a message directly replies to a question and supplies responsive information, emit speechAct=answer and refer to the question event.",
    "Preserve speaker attribution and disagreement. Do not promote participant claims to narrator facts.",
    "semanticImportance estimates explanatory importance from 0 to 1. Prefer developed conclusions over vivid wording, repetition, jokes, or banter.",
    "Every event must cite the source message IDs that directly support it. Omit greetings and content-free noise.",
    "Use short kebab-case topicId values derived only from the topic.",
    "Return JSON only, with exactly this shape:",
    JSON.stringify(
      {
        title: "Short reconstruction title",
        events: [
          {
            id: "m17",
            topicId: "hiring",
            topicTitle: "Hiring discussion",
            speaker: "P2",
            statement: "Concise proposition",
            speechAct:
              "assertion | question | proposal | answer | request | correction | opposition",
            literalness: "literal | ironic | uncertain",
            commitment: "none | tentative | explicit",
            epistemicStatus: "claimed | accepted | rejected | uncertain",
            settled: false,
            action: null,
            refersTo: [],
            stance: "support | oppose | neutral",
            semanticImportance: 0.8,
            confidence: 0.9,
            evidence: [17],
          },
        ],
      },
      null,
      2,
    ),
    `Input representation: ${representation}`,
  ];
  if (languageGuide) sections.push("Input language reference:", languageGuide);
  sections.push("Messages:", serializedMessages);
  return sections.join("\n\n");
}
