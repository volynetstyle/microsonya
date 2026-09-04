import {
  SUMMARIZER_PROFILE,
  type ChatMessage,
  type OllamaClient,
} from "@microsonya/model";
import {
  asParticipantId,
  type ConversationWindow,
  type Summary,
  type SummaryInline,
} from "@microsonya/shared";
import {
  outputSchema,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_RESPONSE_SCHEMA,
  SUMMARY_STREAM_OUTPUT_INSTRUCTIONS,
  SUMMARY_STRUCTURED_OUTPUT_INSTRUCTIONS,
} from "./constants.js";
import { buildModelPolicyPrompt, buildSummaryInputPrompt } from "./prompt.js";
import {
  buildWindowAuthorAliases,
  type ModelWindowMessageRole,
} from "./prompt.js";
import { parseSummaryModelOutput } from "./modelOutput.js";
import type { SummarizationTelemetryTrace } from "./telemetry.js";

export interface ConversationSummarizer {
  summarize(
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): Promise<Summary>;
  stream?(
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): AsyncIterable<string>;
  /** The canonical structured artifact produced by the last completed stream. */
  streamedSummary?(window: ConversationWindow): Summary | undefined;
}

export interface ConversationSummarizerDeps {
  readonly ollama: Pick<OllamaClient, "chat">;
  readonly promptVariant?: SummaryPromptVariant;
}

export type SummaryOutputMode = "structured" | "plain-text";
export type SummaryPromptVariant = "V0" | "V1" | "V2" | "V3";

export interface SummaryPromptOptions {
  readonly outputMode?: SummaryOutputMode;
  readonly promptVariant?: SummaryPromptVariant;
}

const SUMMARY_COMPOSITION_POLICY = `
Before writing the final summary, internally determine the smallest set of
durable propositions needed to represent the eligible conversation.

For every retained proposition preserve:
- subject or entity;
- predicate or event;
- speaker or source when relevant;
- speech act: fact, report, request, proposal, plan, commitment, decision, or completed action;
- modality and uncertainty;
- condition or prerequisite;
- relevant time or deadline.

Do not expose this intermediate representation. Return only the requested final output.

When later messages explicitly replace or correct an earlier state, treat the
later supported state as current. Mention the earlier state only when the change
itself is useful. Never present superseded and current states as simultaneously current.

Keep conditions attached to the claims they constrain. "Y if X" must not become
unconditional "Y". A prerequisite, threshold, fallback, deadline, or exception
must stay associated with the corresponding action or result.

Do not collapse different speech acts:
request != proposal; proposal != plan; plan != commitment;
commitment != decision; decision != completed action;
report != established fact.

Do not fuse propositions from different speakers, entities, conditions,
modalities, or time states into one assertion unless the relation between them
is explicit. Fluent prose is not evidence for a semantic relation.
`.trim();

/**
 * Compact contrasts derived from the approved semantic regression fixtures.
 * They demonstrate the failure boundary instead of teaching a preferred style.
 */
function buildSummaryContrastExamples(outputMode: SummaryOutputMode): string {
  const supportedFirst =
    "Реліз перенесли на четвер. Checkout увімкнуть у четвер за умови успішних smoke-тестів; інакше — у п'ятницю.";
  const unsupportedFirst =
    "Реліз заплановано на п'ятницю, а checkout безумовно ввімкнуть у четвер.";
  const supportedSecond =
    "Переслане повідомлення про скасування стосувалося іншого проєкту. Нашу міграцію не скасовано: staging завершено, production заплановано на завтра.";
  const unsupportedSecond =
    "Нашу міграцію скасовано, бо наша база не витримує навантаження.";
  const output = (summary: string) =>
    outputMode === "structured" ? JSON.stringify({ summary }) : summary;

  return `
SEMANTIC_CONTRAST_EXAMPLES_BEGIN

Example 1 — supersession and condition binding
Visible facts:
- The release was first proposed for Friday, then explicitly moved to Thursday.
- Checkout is enabled Thursday only if Thursday evening smoke tests pass;
  otherwise checkout moves to Friday.
Correct final output:
${output(supportedFirst)}
Incorrect final output:
${output(unsupportedFirst)}

Example 2 — provenance and attribution
Visible facts:
- A forwarded cancellation message came from another project.
- The visible conversation explicitly says it does not concern our migration.
- Our staging migration completed and our production migration remains planned.
Correct final output:
${output(supportedSecond)}
Incorrect final output:
${output(unsupportedSecond)}

SEMANTIC_CONTRAST_EXAMPLES_END
`.trim();
}

export function createConversationSummarizer({
  ollama,
  promptVariant = "V2",
}: ConversationSummarizerDeps): ConversationSummarizer {
  const streamed = new WeakMap<ConversationWindow, Summary>();
  const stream = async function* (
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): AsyncIterable<string> {
    signal?.throwIfAborted();
    const messages = buildSummaryMessages(window, roles, {
      outputMode: "plain-text",
      promptVariant,
    });
    const prompt = messages.map(({ content }) => content).join("\n\n");
    telemetry?.record({
      type: "model.request",
      stage: "summarizer",
      model: SUMMARIZER_PROFILE.model,
      messageCount: window.messages.length,
      promptChars: prompt.length,
      prompt,
    });
    const startedAt = performance.now();
    let content = "";
    let pendingAlias = "";
    const aliases = aliasesByWindowToken(window);
    for await (const event of ollama.chat(
      {
        ...SUMMARIZER_PROFILE,
        format: undefined,
        stream: true,
        messages,
      },
      { signal },
    )) {
      signal?.throwIfAborted();
      const delta = event.message.content;
      if (delta.length > 0) {
        content += delta;
        const joined = pendingAlias + delta;
        const trailing = joined.match(/@(\d*)$/u)?.[0] ?? "";
        const stable = joined.slice(0, joined.length - trailing.length);
        pendingAlias = trailing;
        if (stable.length > 0) yield replaceWindowAliases(stable, aliases);
      }
    }
    const durationMs = performance.now() - startedAt;
    if (content.trim().length === 0) {
      throw new TypeError("Streaming summarizer returned empty output.");
    }
    if (pendingAlias.length > 0)
      yield replaceWindowAliases(pendingAlias, aliases);
    streamed.set(window, summaryFromWindowAliases(content, aliases));
    telemetry?.record({
      type: "model.response",
      stage: "summarizer",
      model: SUMMARIZER_PROFILE.model,
      attempt: 1,
      durationMs,
      responseChars: content.length,
      summaryChars: content.length,
    });
  };

  return {
    stream,
    streamedSummary: (window) => streamed.get(window),
    summarize: async (window, signal, telemetry, roles) => {
      signal?.throwIfAborted();
      const messages = buildSummaryMessages(window, roles, {
        outputMode: "structured",
        promptVariant,
      });
      const prompt = messages.map(({ content }) => content).join("\n\n");
      telemetry?.record({
        type: "model.request",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        messageCount: window.messages.length,
        promptChars: prompt.length,
        prompt,
      });
      const startedAt = performance.now();
      const response = await ollama.chat(
        {
          ...SUMMARIZER_PROFILE,
          format: SUMMARY_RESPONSE_SCHEMA,
          stream: false,
          messages,
        },
        { signal },
      );
      signal?.throwIfAborted();

      const durationMs = performance.now() - startedAt;
      telemetry?.record({
        type: "model.response.envelope",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        durationMs,
        done: response.done,
        doneReason: response.done_reason,
        promptEvalCount: response.prompt_eval_count,
        evalCount: response.eval_count,
        contentChars: response.message.content.length,
        thinkingChars: response.message.thinking?.length ?? 0,
        content: response.message.content,
        thinking: response.message.thinking,
      });
      const { summary, outputEnvelope } = parseSummaryModelOutput({
        raw: response.message.content,
        schema: outputSchema,
        model: SUMMARIZER_PROFILE.model,
        durationMs,
        attempt: 1,
        telemetry,
      });
      telemetry?.record({
        type: "summarizer.output_mode",
        mode: outputEnvelope,
      });
      telemetry?.record({
        type: "model.response",
        stage: "summarizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        durationMs,
        responseChars: response.message.content.length,
        summaryChars: summary.length,
      });
      return summaryFromWindowAliases(summary, aliasesByWindowToken(window));
    },
  };
}

/**
 * The model can identify a speaker only with the already-visible window-local
 * `@N` handle. Convert those explicit references after inference; labels never
 * enter model input and no natural-language name is searched or replaced.
 */
function aliasesByWindowToken(
  window: ConversationWindow,
): ReadonlyMap<
  string,
  { readonly participantId: string; readonly sourceLabel: string }
> {
  const aliases = buildWindowAuthorAliases(window);
  return new Map(
    window.messages.map((message) => [
      aliases.get(message.author.id)!,
      {
        participantId: message.author.id,
        sourceLabel: message.author.label,
      },
    ]),
  );
}

function replaceWindowAliases(
  text: string,
  aliases: ReadonlyMap<
    string,
    { readonly participantId: string; readonly sourceLabel: string }
  >,
): string {
  return text.replace(
    /@(\d+)\b/gu,
    (token) => aliases.get(token)?.sourceLabel ?? token,
  );
}

function summaryFromWindowAliases(
  text: string,
  aliases: ReadonlyMap<
    string,
    { readonly participantId: string; readonly sourceLabel: string }
  >,
): Summary {
  const inline: SummaryInline[] = [];
  let textStart = 0;
  for (const match of text.matchAll(/@(\d+)\b/gu)) {
    const token = match[0];
    const participant = aliases.get(token);
    if (participant === undefined || match.index === undefined) continue;
    if (match.index > textStart) {
      inline.push({ type: "text", value: text.slice(textStart, match.index) });
    }
    inline.push({
      type: "participant",
      participantId: asParticipantId(participant.participantId),
    });
    textStart = match.index + token.length;
  }
  if (inline.length === 0) return Object.freeze({ text });
  if (textStart < text.length) {
    inline.push({ type: "text", value: text.slice(textStart) });
  }
  return Object.freeze({
    text: replaceWindowAliases(text, aliases),
    inline: Object.freeze(inline),
  });
}

export function buildSummaryPrompt(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): string {
  return buildSummaryMessages(window, roles)
    .map(({ content }) => content)
    .join("\n\n");
}

export function buildSummaryMessages(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
  options: SummaryPromptOptions = {},
): ChatMessage[] {
  const { outputMode = "structured", promptVariant = "V2" } = options;
  const outputInstructions =
    outputMode === "structured"
      ? SUMMARY_STRUCTURED_OUTPUT_INSTRUCTIONS
      : SUMMARY_STREAM_OUTPUT_INSTRUCTIONS;
  const trustedSections = [
    buildModelPolicyPrompt("SUMMARY_POLICY", SUMMARY_INSTRUCTIONS),
    ...(promptVariant === "V2" || promptVariant === "V3"
      ? [
          `SEMANTIC_COMPOSITION_POLICY_BEGIN\n${SUMMARY_COMPOSITION_POLICY}\nSEMANTIC_COMPOSITION_POLICY_END`,
        ]
      : []),
    outputInstructions,
    ...(promptVariant === "V3"
      ? [buildSummaryContrastExamples(outputMode)]
      : []),
  ].join("\n\n");
  // Never inherit classifier-only reply capsules. The canonical transcript is
  // the summarizer's complete source of events and attribution.
  const input = buildSummaryInputPrompt(window, roles);

  if (promptVariant === "V0") {
    return [{ role: "user", content: `${trustedSections}\n\n${input}` }];
  }

  return [
    { role: "system", content: trustedSections },
    { role: "user", content: input },
  ];
}
