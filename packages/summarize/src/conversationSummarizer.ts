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
  type SummaryPlan,
} from "@microsonya/shared";
import {
  buildWindowAuthorAliases,
  type ModelWindowMessageRole,
} from "./prompt.js";
import {
  contentSourceKey,
  createSummaryPlanExtractor,
  validateSummaryPlan,
  type SummaryPlanExtractor,
} from "./summaryPlan.js";
import type { SummarizationTelemetryTrace } from "./telemetry.js";

export const SUMMARY_PROMPT_VERSION = "summary-v2";

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
  /** Production two-phase boundary. Extraction and validation finish first. */
  prepare?(
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): Promise<SummaryPlan>;
  realizePlan?(
    plan: SummaryPlan,
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
  ): Promise<Summary>;
  streamPlan?(
    plan: SummaryPlan,
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
  ): AsyncIterable<string>;
  /** Canonical structured artifact produced by the last completed stream. */
  streamedSummary?(window: ConversationWindow): Summary | undefined;
}

export interface ConversationSummarizerDeps {
  readonly ollama: Pick<OllamaClient, "chat">;
}

export interface SummaryRealizer {
  realize(
    plan: SummaryPlan,
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
  ): Promise<Summary>;
  stream(
    plan: SummaryPlan,
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
  ): AsyncIterable<string>;
  streamedSummary(window: ConversationWindow): Summary | undefined;
}

export function createConversationSummarizer({
  ollama,
}: ConversationSummarizerDeps): ConversationSummarizer {
  const extractor = createSummaryPlanExtractor({ ollama });
  const realizer = createSummaryRealizer({ ollama });
  return composeSummaryPipeline(extractor, realizer);
}

export function composeSummaryPipeline(
  extractor: SummaryPlanExtractor,
  realizer: SummaryRealizer,
): ConversationSummarizer {
  const prepare: NonNullable<ConversationSummarizer["prepare"]> = (
    window,
    signal,
    telemetry,
    roles,
  ) => extractor.extract(window, signal, telemetry, roles);
  const realizePlan: NonNullable<ConversationSummarizer["realizePlan"]> = (
    plan,
    window,
    signal,
    telemetry,
  ) => realizer.realize(plan, window, signal, telemetry);
  const streamPlan: NonNullable<ConversationSummarizer["streamPlan"]> = (
    plan,
    window,
    signal,
    telemetry,
  ) => realizer.stream(plan, window, signal, telemetry);

  return {
    prepare,
    realizePlan,
    streamPlan,
    streamedSummary: (window) => realizer.streamedSummary(window),
    summarize: async (window, signal, telemetry, roles) => {
      const plan = await prepare(window, signal, telemetry, roles);
      return realizePlan(plan, window, signal, telemetry);
    },
    stream: async function* (window, signal, telemetry, roles) {
      const plan = await prepare(window, signal, telemetry, roles);
      yield* streamPlan(plan, window, signal, telemetry);
    },
  };
}

export function createSummaryRealizer(deps: {
  readonly ollama: Pick<OllamaClient, "chat">;
}): SummaryRealizer {
  const streamed = new WeakMap<ConversationWindow, Summary>();
  return {
    streamedSummary: (window) => streamed.get(window),
    realize: async (plan, window, signal, telemetry) => {
      signal?.throwIfAborted();
      const validated = validateSummaryPlan(plan, window);
      const messages = buildSummaryRealizationMessages(validated, window);
      const prompt = messages.map(({ content }) => content).join("\n\n");
      telemetry?.record({
        type: "model.request",
        stage: "realizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        messageCount: window.messages.length,
        promptChars: prompt.length,
        prompt,
      });
      const startedAt = performance.now();
      const response = await deps.ollama.chat(
        {
          ...SUMMARIZER_PROFILE,
          stream: false,
          messages,
        },
        { signal },
      );
      signal?.throwIfAborted();
      const durationMs = performance.now() - startedAt;
      const content = response.message.content.trim();
      telemetry?.record({
        type: "model.response.envelope",
        stage: "realizer",
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
      if (content.length === 0) {
        throw new TypeError("Summary realizer returned empty output.");
      }
      telemetry?.record({
        type: "model.response",
        stage: "realizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        durationMs,
        responseChars: response.message.content.length,
        summaryChars: content.length,
      });
      return summaryFromWindowAliases(content, aliasesByWindowToken(window));
    },
    stream: async function* (plan, window, signal, telemetry) {
      signal?.throwIfAborted();
      const validated = validateSummaryPlan(plan, window);
      const messages = buildSummaryRealizationMessages(validated, window);
      const prompt = messages.map(({ content }) => content).join("\n\n");
      telemetry?.record({
        type: "model.request",
        stage: "realizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        messageCount: window.messages.length,
        promptChars: prompt.length,
        prompt,
      });
      const startedAt = performance.now();
      let content = "";
      let pendingAlias = "";
      const aliases = aliasesByWindowToken(window);
      for await (const event of deps.ollama.chat(
        {
          ...SUMMARIZER_PROFILE,
          stream: true,
          messages,
        },
        { signal },
      )) {
        signal?.throwIfAborted();
        const delta = event.message.content;
        if (delta.length === 0) continue;
        content += delta;
        const joined = pendingAlias + delta;
        const trailing = joined.match(/[@$](\d*)$/u)?.[0] ?? "";
        const stable = joined.slice(0, joined.length - trailing.length);
        pendingAlias = trailing;
        if (stable.length > 0) yield replaceWindowAliases(stable, aliases);
      }
      const durationMs = performance.now() - startedAt;
      if (content.trim().length === 0) {
        throw new TypeError(
          "Streaming summary realizer returned empty output.",
        );
      }
      if (pendingAlias.length > 0) {
        yield replaceWindowAliases(pendingAlias, aliases);
      }
      streamed.set(window, summaryFromWindowAliases(content, aliases));
      telemetry?.record({
        type: "model.response",
        stage: "realizer",
        model: SUMMARIZER_PROFILE.model,
        attempt: 1,
        durationMs,
        responseChars: content.length,
        summaryChars: content.length,
      });
    },
  };
}

export function buildSummaryRealizationMessages(
  plan: SummaryPlan,
  window: ConversationWindow,
): ChatMessage[] {
  const validated = validateSummaryPlan(plan, window);
  return [
    { role: "system", content: SUMMARY_REALIZATION_INSTRUCTIONS },
    {
      role: "user",
      content: `SUMMARY_PLAN_BEGIN\n${JSON.stringify(realizerView(validated, window))}\nSUMMARY_PLAN_END`,
    },
  ];
}

type WindowIdentityToken =
  | {
      readonly kind: "participant";
      readonly participantId: string;
      readonly sourceLabel: string;
    }
  | {
      readonly kind: "source";
      readonly sourceKey: string;
      readonly sourceLabel: string;
    };

function realizerView(plan: SummaryPlan, window: ConversationWindow) {
  const aliases = aliasesByWindowToken(window);
  const participantTokenById = new Map(
    [...aliases.entries()]
      .filter(
        (
          entry,
        ): entry is [
          string,
          Extract<WindowIdentityToken, { kind: "participant" }>,
        ] => entry[1].kind === "participant",
      )
      .map(([token, value]) => [value.participantId, token]),
  );
  const sourceTokenById = new Map(
    [...aliases.entries()]
      .filter(
        (
          entry,
        ): entry is [
          string,
          Extract<WindowIdentityToken, { kind: "source" }>,
        ] => entry[1].kind === "source",
      )
      .map(([token, value]) => [value.sourceKey, token]),
  );
  const retained = new Set(plan.retainedClaimIds);
  return {
    schemaVersion: "summary-plan-v0.1",
    referents: plan.referents,
    claims: plan.claims
      .filter(({ id }) => retained.has(id))
      .map((claim) => ({
        ...claim,
        speaker:
          claim.speakerId === undefined
            ? null
            : (participantTokenById.get(claim.speakerId) ?? null),
        source:
          claim.sourceId === undefined
            ? null
            : (sourceTokenById.get(claim.sourceId) ?? null),
        speakerId: undefined,
        sourceId: undefined,
      })),
  };
}

function aliasesByWindowToken(
  window: ConversationWindow,
): ReadonlyMap<string, WindowIdentityToken> {
  const authorAliases = buildWindowAuthorAliases(window);
  const resolved = new Map<string, WindowIdentityToken>();
  for (const message of window.messages) {
    resolved.set(authorAliases.get(message.author.id)!, {
      kind: "participant",
      participantId: message.author.id,
      sourceLabel: message.author.label,
    });
    const source = message.contentSource;
    if (source === undefined) continue;
    const key = contentSourceKey(source);
    const exists = [...resolved.values()].some(
      (value) => value.kind === "source" && value.sourceKey === key,
    );
    if (!exists) {
      resolved.set(
        `$${[...resolved.keys()].filter((value) => value.startsWith("$")).length + 1}`,
        {
          kind: "source",
          sourceKey: key,
          sourceLabel: source.label,
        },
      );
    }
  }
  return resolved;
}

function replaceWindowAliases(
  text: string,
  aliases: ReadonlyMap<string, WindowIdentityToken>,
): string {
  return text.replace(
    /[@$](\d+)\b/gu,
    (token) => aliases.get(token)?.sourceLabel ?? token,
  );
}

function summaryFromWindowAliases(
  text: string,
  aliases: ReadonlyMap<string, WindowIdentityToken>,
): Summary {
  const inline: SummaryInline[] = [];
  let textStart = 0;
  for (const match of text.matchAll(/[@$](\d+)\b/gu)) {
    const token = match[0];
    const identity = aliases.get(token);
    if (identity === undefined || match.index === undefined) continue;
    if (match.index > textStart) {
      inline.push({ type: "text", value: text.slice(textStart, match.index) });
    }
    if (identity.kind === "participant") {
      inline.push({
        type: "participant",
        participantId: asParticipantId(identity.participantId),
      });
    } else {
      inline.push({ type: "text", value: identity.sourceLabel });
    }
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

const SUMMARY_REALIZATION_INSTRUCTIONS = `
Write a concise natural Ukrainian summary using only the validated SummaryPlan.
Return plain text only: no JSON and no Markdown.

You may change wording, paragraphing, ordering, and compression. You must not
change or invent a speaker, source, referent identity, numeric value, numeric
unit, numeric dimension, epistemic status, condition, or fact. Realize only the
claims present in the plan. Do not infer from omitted claims or outside context.

Preserve epistemic force explicitly: reported and claimed material remains
attributed; speculated material remains uncertain; proposed material is not a
decision; conditional material keeps its condition. A duration is never an
occurrence count or ordinal event.

When a participant must be named, emit the provided @N token verbatim. When a
content source must be named, emit the provided $N token verbatim. Rendering
will resolve these canonical references after generation.
`.trim();
