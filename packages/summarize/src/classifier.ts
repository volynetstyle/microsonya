import { CLASSIFIER_PROFILE, type OllamaClient } from "@microsonya/model";
import {
  type ConversationWindow,
  type SummaryAction,
  type SummaryDecision,
} from "@microsonya/shared";
import { z } from "zod";
import {
  buildClassifierInputRepresentation,
  buildModelPolicyPrompt,
  buildSummaryInputPrompt,
} from "./prompt.js";
import { ModelOutputError, parseModelOutput } from "./modelOutput.js";
import { COMPACTION_DECISION_INSTRUCTIONS } from "./predicateV3.js";
import { LEGACY_COMPACTION_DECISION_INSTRUCTIONS } from "./legacyPredicateV3.js";
import type { ModelWindowMessageRole } from "./prompt.js";
import type { SummarizationTelemetryTrace } from "./telemetry.js";

/**
 * | Label | Семантика |
 * |---|---|
 * | `SUMMARIZE` | Є durable information, яку потрібно синтезувати у структурно яснішу модель |
 * | `DEFER_COMPACT` | Durable information вже достатньо компактно сформульована; summary переважно повторить її |
 * | `DEFER_INCOMPLETE` | Конкретний результат, відповідь, перевірка, пояснення, рішення або alternatives ще очікуються |
 * | `DEFER_CONTEXT` | Є durable information, але essential referent неможливо безпечно визначити з visible window |
 * | `SKIP_BANTER` | Вікно переважно складається з жартів або social banter без durable value |
 * | `SKIP_REACTIONS` | Вікно складається лише з greetings, acknowledgements, reactions, laughter, emoji або коротких відповідей |
 * | `SKIP_NO_VALUE` | Є якась тема чи оцінка, але немає конкретної durable information |
 */
/** @deprecated Prefer the domain name SummaryAction. */
export type CompactionAction = SummaryAction;

const nonDurableKindSchema = z.enum(["reaction", "banter", "no_value"]);

const legacyClassifierOutputSchema = z
  .object({
    durable: z.boolean(),
    essentialReferentsResolved: z.boolean(),
    visiblyIncomplete: z.boolean(),
    alreadyCompact: z.boolean(),
    primarilyReaction: z.boolean(),
    primarilyBanter: z.boolean(),
    requiresSynthesis: z.boolean(),
  })
  .strict();

const classifierOutputSchema = z
  .object({
    durable: z.boolean(),
    nonDurableKind: nonDurableKindSchema.nullable(),
    essentialReferentsResolved: z.boolean().nullable(),
    visiblyIncomplete: z.boolean().nullable(),
    requiresSynthesis: z.boolean().nullable(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const payloadFields = [
      evidence.essentialReferentsResolved,
      evidence.visiblyIncomplete,
      evidence.requiresSynthesis,
    ];
    const valid = evidence.durable
      ? evidence.nonDurableKind === null &&
        payloadFields.every((value) => value !== null)
      : evidence.nonDurableKind !== null &&
        payloadFields.every((value) => value === null);
    if (!valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence must follow the durable decision branch.",
      });
    }
  });

export type ClassificationPredicates = z.infer<typeof classifierOutputSchema>;

export interface SummaryDecisionClassifier {
  classify(
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): Promise<SummaryDecision>;
}

export interface ClassifierDeps {
  readonly ollama: Pick<OllamaClient, "chat">;
}

export type ClassifierEvalRegime = "A0" | "B0" | "B1" | "A1" | "A2";
export type ClassifierExemplarMode = "current" | "none" | "hardest";

export interface ClassifierOptions {
  /** Offline ablation only. Production is frozen to A2. */
  readonly evalRegime?: ClassifierEvalRegime;
  /** Offline robustness probe; indexes the five contrast examples. */
  readonly exemplarOrder?: readonly number[];
  readonly exemplarMode?: ClassifierExemplarMode;
  readonly evalPolicyOverride?: string;
}

export function createClassifier(
  deps: ClassifierDeps,
  options: ClassifierOptions = {},
): SummaryDecisionClassifier {
  return {
    classify: async (window, signal, telemetry, roles) => {
      signal?.throwIfAborted();
      const regime = options.evalRegime ?? "A2";
      const usesLegacyEvidence = ["A0", "B0", "B1"].includes(regime);
      const systemPrompt = buildClassifierSystemPrompt(
        regime,
        options.exemplarOrder,
        options.exemplarMode,
        options.evalPolicyOverride,
      );
      const userPrompt = buildClassifierInputPrompt(
        window,
        roles,
        regime === "A2",
      );
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const numPredict =
          CLASSIFIER_PROFILE.options.num_predict * (attempt === 1 ? 1 : 2);
        telemetry?.record({
          type: "model.request",
          stage: "classifier",
          model: CLASSIFIER_PROFILE.model,
          attempt,
          numPredict,
          messageCount: window.messages.length,
          promptChars: systemPrompt.length + userPrompt.length,
          prompt: combinedPrompt,
        });
        const startedAt = performance.now();
        const response = await deps.ollama.chat(
          {
            ...CLASSIFIER_PROFILE,
            options: {
              ...CLASSIFIER_PROFILE.options,
              num_predict: numPredict,
            },
            stream: false,
            format:
              regime === "A0" || regime === "B0"
                ? "json"
                : regime === "B1"
                  ? LEGACY_CLASSIFIER_RESPONSE_SCHEMA
                  : CLASSIFIER_RESPONSE_SCHEMA,
            messages:
              regime === "A0"
                ? [{ role: "user", content: combinedPrompt }]
                : [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                  ],
          },
          { signal },
        );
        signal?.throwIfAborted();

        const durationMs = performance.now() - startedAt;
        telemetry?.record({
          type: "model.response.envelope",
          stage: "classifier",
          model: CLASSIFIER_PROFILE.model,
          attempt,
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

        try {
          const parseArgs = {
            raw: response.message.content,
            stage: "classifier" as const,
            model: CLASSIFIER_PROFILE.model,
            durationMs,
            attempt,
            telemetry,
          };
          const predicates = usesLegacyEvidence
            ? parseModelOutput({
                ...parseArgs,
                schema: legacyClassifierOutputSchema,
              })
            : parseModelOutput({
                ...parseArgs,
                schema: classifierOutputSchema,
              });
          const action = usesLegacyEvidence
            ? decideFromLegacyPredicates(
                predicates as unknown as z.infer<
                  typeof legacyClassifierOutputSchema
                >,
              )
            : decideFromPredicates(predicates as ClassificationPredicates);
          telemetry?.record({
            type: "model.response",
            stage: "classifier",
            model: CLASSIFIER_PROFILE.model,
            attempt,
            durationMs,
            responseChars: response.message.content.length,
            action,
            predicates: usesLegacyEvidence
              ? legacyToEvidence(
                  predicates as unknown as z.infer<
                    typeof legacyClassifierOutputSchema
                  >,
                )
              : (predicates as ClassificationPredicates),
          });
          return {
            action,
            evidence: {
              source: "model",
              model: CLASSIFIER_PROFILE.model,
            },
          };
        } catch (error) {
          const retryableOutputFailure =
            error instanceof ModelOutputError &&
            (error.code === "MODEL_OUTPUT_EMPTY" ||
              response.done_reason === "length");
          if (retryableOutputFailure && attempt === 1) {
            telemetry?.record({
              type: "model.request.retry",
              stage: "classifier",
              model: CLASSIFIER_PROFILE.model,
              failedAttempt: attempt,
              nextAttempt: attempt + 1,
              reason: error.code,
            });
            continue;
          }
          throw error;
        }
      }

      throw new Error("Classifier retry loop exited without a decision.");
    },
  };
}

/** Deterministic policy: semantic predicates are model evidence, action is code. */
export function decideFromPredicates(
  predicates: ClassificationPredicates,
): SummaryAction {
  if (!predicates.durable) {
    if (predicates.nonDurableKind === "reaction") return "SKIP_REACTIONS";
    if (predicates.nonDurableKind === "banter") return "SKIP_BANTER";
    return "SKIP_NO_VALUE";
  }
  if (!predicates.essentialReferentsResolved) return "DEFER_CONTEXT";
  if (predicates.visiblyIncomplete) return "DEFER_INCOMPLETE";
  if (!predicates.requiresSynthesis) return "DEFER_COMPACT";
  return "SUMMARIZE";
}

function decideFromLegacyPredicates(
  predicates: z.infer<typeof legacyClassifierOutputSchema>,
): SummaryAction {
  if (!predicates.durable) {
    if (predicates.primarilyReaction) return "SKIP_REACTIONS";
    if (predicates.primarilyBanter) return "SKIP_BANTER";
    return "SKIP_NO_VALUE";
  }
  if (!predicates.essentialReferentsResolved) return "DEFER_CONTEXT";
  if (predicates.visiblyIncomplete) return "DEFER_INCOMPLETE";
  if (predicates.alreadyCompact || !predicates.requiresSynthesis) {
    return "DEFER_COMPACT";
  }
  return "SUMMARIZE";
}

function legacyToEvidence(
  predicates: z.infer<typeof legacyClassifierOutputSchema>,
): ClassificationPredicates {
  if (!predicates.durable) {
    return {
      durable: false,
      nonDurableKind: predicates.primarilyReaction
        ? "reaction"
        : predicates.primarilyBanter
          ? "banter"
          : "no_value",
      essentialReferentsResolved: null,
      visiblyIncomplete: null,
      requiresSynthesis: null,
    };
  }
  return {
    durable: true,
    nonDurableKind: null,
    essentialReferentsResolved: predicates.essentialReferentsResolved,
    visiblyIncomplete: predicates.visiblyIncomplete,
    requiresSynthesis: predicates.alreadyCompact
      ? false
      : predicates.requiresSynthesis,
  };
}

export const CLASSIFIER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "durable",
    "nonDurableKind",
    "essentialReferentsResolved",
    "visiblyIncomplete",
    "requiresSynthesis",
  ],
  properties: {
    durable: { type: "boolean" },
    nonDurableKind: {
      anyOf: [{ enum: ["reaction", "banter", "no_value"] }, { type: "null" }],
    },
    essentialReferentsResolved: { type: ["boolean", "null"] },
    visiblyIncomplete: { type: ["boolean", "null"] },
    requiresSynthesis: { type: ["boolean", "null"] },
  },
} as const;

export const LEGACY_CLASSIFIER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "durable",
    "essentialReferentsResolved",
    "visiblyIncomplete",
    "alreadyCompact",
    "primarilyReaction",
    "primarilyBanter",
    "requiresSynthesis",
  ],
  properties: {
    durable: { type: "boolean" },
    essentialReferentsResolved: { type: "boolean" },
    visiblyIncomplete: { type: "boolean" },
    alreadyCompact: { type: "boolean" },
    primarilyReaction: { type: "boolean" },
    primarilyBanter: { type: "boolean" },
    requiresSynthesis: { type: "boolean" },
  },
} as const;

export function buildClassifierSystemPrompt(
  regime: ClassifierEvalRegime = "A2",
  exemplarOrder?: readonly number[],
  exemplarMode: ClassifierExemplarMode = "current",
  evalPolicyOverride?: string,
): string {
  const policy =
    evalPolicyOverride ??
    (["A0", "B0", "B1"].includes(regime)
      ? LEGACY_COMPACTION_DECISION_INSTRUCTIONS
      : selectClassifierExemplars(
          reorderClassifierExemplars(
            COMPACTION_DECISION_INSTRUCTIONS,
            exemplarOrder,
          ),
          exemplarMode,
        ));
  return buildModelPolicyPrompt("CLASSIFICATION_POLICY", policy);
}

export function buildClassifierInputPrompt(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
  includeReplyContextCapsules = true,
): string {
  if (!includeReplyContextCapsules || roles === undefined) {
    return buildSummaryInputPrompt(window, roles);
  }
  return buildClassifierInputRepresentation(window, roles);
}

export function buildClassifierPrompt(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
): string {
  return `${buildClassifierSystemPrompt()}\n\n${buildClassifierInputPrompt(window, roles)}`;
}

const CONTRAST_MARKER = "CONTRASTIVE BOUNDARIES\n\n";

export function selectClassifierExemplars(
  policy: string,
  mode: ClassifierExemplarMode,
): string {
  if (mode === "current") return policy;
  const markerIndex = policy.indexOf(CONTRAST_MARKER);
  if (markerIndex < 0)
    throw new TypeError("Classifier contrast marker missing.");
  if (mode === "none") return policy.slice(0, markerIndex).trimEnd();
  const start = markerIndex + CONTRAST_MARKER.length;
  const examples = policy.slice(start).split("\n\n");
  return `${policy.slice(0, start)}${[examples[0], examples[3]].join("\n\n")}`;
}

export function reorderClassifierExemplars(
  policy: string,
  order: readonly number[] | undefined,
): string {
  if (order === undefined) return policy;
  const markerIndex = policy.indexOf(CONTRAST_MARKER);
  if (markerIndex < 0)
    throw new TypeError("Classifier contrast marker missing.");
  const start = markerIndex + CONTRAST_MARKER.length;
  const examples = policy.slice(start).split("\n\n");
  if (
    order.length !== examples.length ||
    new Set(order).size !== examples.length ||
    order.some((index) => index < 0 || index >= examples.length)
  ) {
    throw new TypeError(`Expected a permutation of 0..${examples.length - 1}.`);
  }
  return `${policy.slice(0, start)}${order
    .map((index) => examples[index])
    .join("\n\n")}`;
}

/* Legacy predicate-v2 policy retained temporarily for review; not executable.
    Choose whether this chat window should now be summarized into durable history.

    First extract independent semantic predicates. Then propose an action.
    Return JSON only with exactly these fields:
    {"durable":boolean,"essentialReferentsResolved":boolean,"visiblyIncomplete":boolean,"alreadyCompact":boolean,"primarilyReaction":boolean,"primarilyBanter":boolean,"requiresSynthesis":boolean,"proposedAction":"ONE_LABEL"}.

    Predicate rules:
    - durable is true when the window contains ANY concrete information that could be usefully recovered later from a summary instead of rereading the raw messages. Judge presence and semantic mass, not the majority atmosphere or message count.
    - Concrete recoverable information includes work and technical facts, but also personal events, purchases, disputes, experiences, recommendations, explanations, and stories with identifiable participants, circumstances, causes, outcomes, constraints, or next steps.
    - Durable does not mean serious, professional, permanent, exceptional, or globally important. Informal language, profanity, humor, exaggeration, and a casual social setting do not make concrete information non-durable.
    - primarilyBanter describes a window where jokes, wordplay, teasing, or social reactions are themselves the semantic substance. It is false when casual banter merely surrounds or comments on a concrete recoverable event.
    - primarilyBanter may still be true together with durable when a small durable island exists inside otherwise unrelated banter. High banter density never erases that island.
    - essentialReferentsResolved concerns only referents required to preserve the durable payload.
    - requiresSynthesis is true when integrating multiple distinct facts, relations, steps, constraints, or phases produces a materially clearer durable model.
    - Message boundaries are not semantically significant. The information that requires synthesis may occur inside one message or across many messages.
    - proposedAction follows the ordered policy below. Code will independently derive the final action from the predicates.

    Apply these rules in order. Stop at the first matching rule.

    1. IF every message is only a greeting, acknowledgement, emotional reaction, laughter, emoji, or short response to another message, AND no message expresses even a vague problem, proposal, assessment, or topic:
    RETURN SKIP_REACTIONS

    2. IF the window is primarily jokes, wordplay, playful exaggeration, or social banter, and contains no durable information worth preserving:
    RETURN SKIP_BANTER

    3. IF the window contains only vague discussion, concern, assessment, or a proposal without a concrete durable object, decision, plan, argument, or result:
    RETURN SKIP_NO_VALUE.

    A named component, system behaviour, technical defect, or concrete problem is a concrete durable object even before a decision is made.

    Likewise, a concrete agreement, dependency, exception, or deadline expressed with unresolved aliases or pronouns is not no-value; continue to the context rule instead.

    4. IF any referent essential to preserving the durable information is unresolved in this window:
    RETURN DEFER_CONTEXT

    Return DEFER_CONTEXT even if there is a deadline, apparent agreement, or otherwise compact-looking update.

    An unresolved joke, optional name, or other banter is not essential when an independent durable decision is fully specified.

    Do not guess who, what object, what proposal, what task, or what deliverable is meant.

    5. IF the visible exchange contains an unverified hypothesis, uncertainty, or explicitly shows that a result, answer, verification, explanation, decision, or set of alternatives is still pending:
    RETURN DEFER_INCOMPLETE

    A known current status such as “access is pending”, “review is in progress”, “deployment is queued”, or “rollback is scheduled” is not by itself an incomplete exchange when the status is the complete information being communicated.

    Return DEFER_INCOMPLETE when the exchange is explicitly awaiting information necessary to settle the proposition or outcome currently being developed.

    6. IF all durable information is already stated as one self-contained decision, status update, result, short plan, or compact list of invariants, AND a future reader would gain no materially shorter or clearer model from cross-message synthesis:
    RETURN DEFER_COMPACT

    Here, a short plan means one action, or one action with a deadline.

    It does not include a staged schedule with gates, thresholds, prerequisites, fallback, or rollback.

    A steady-state architecture contract plus a temporary compatibility path and criteria for removing that path are two semantic phases, not one compact item.

    Message length and the number of facts do not by themselves justify summarization.

    7. RETURN SUMMARIZE when distinct durable facts, relations, steps, constraints, or phases must be integrated into a materially clearer model.

    Apply this rule identically whether those semantic units appear inside one message or across multiple messages. Never use Telegram message count or boundaries as evidence for or against synthesis.

    Strong signals are:

    - multiple dependent steps;
    - sequencing;
    - prerequisites;
    - thresholds;
    - fallback or rollback conditions;
    - parallel work streams;
    - an architecture contract plus a separate migration, compatibility, or retirement lifecycle.

    A plan is not “one short plan” merely because its steps can be listed in one sentence.

    Boundary examples:

    Messages:
    "A friend only went to ask about a PC and said she could not afford one now."
    "Her grandfather insisted, so the seller assembled a 70k PC anyway."
    "Only 12k of that price is the graphics card; we suggested returning the parts and rebuilding it."
    "ахах, прекрасно її намахали"
    => durable=true, primarilyBanter=false, requiresSynthesis=true, proposedAction=SUMMARIZE

    Messages:
    "70k за комп ахахаха"
    "💀"
    "це піздец"
    "ну зато красивий"
    => durable=false, primarilyBanter=true, requiresSynthesis=false, proposedAction=SKIP_BANTER

    Messages:
    "Deploy moved to Thursday."
    "Stripe production access is pending."
    => proposedAction=DEFER_COMPACT

    Messages:
    "He agreed."
    "Not to option two, to the one discussed yesterday."
    => proposedAction=DEFER_CONTEXT

    Messages:
    "ахахах"
    "😭😭"
    "жесть"
    "💀"
    => proposedAction=SKIP_REACTIONS

    Messages:
    "We need to change something."
    "Maybe; it is not very good now."
    => proposedAction=SKIP_NO_VALUE

    Messages:
    "I found the memory leak."
    "It seems subscriptions are not disposed."
    "I am checking with a heap snapshot."
    => proposedAction=DEFER_INCOMPLETE

    Messages:
    "He agreed."
    "Not option two; the one discussed yesterday."
    "It must be ready Friday."
    => proposedAction=DEFER_CONTEXT

    Messages:
    "Renderer invariants: framework does not own state; core imports no UI framework or DOM; UI uses an adapter; renderer is replaceable."
    => proposedAction=DEFER_COMPACT

    Messages:
    "Він погодився."
    "Не на другий варіант, а на той, що обговорювали вчора."
    "До п’ятниці має бути готово."
    => proposedAction=DEFER_CONTEXT

    Messages:
    "Треба змінити схему кешування API: весь response ламає персоналізовані поля."
    "Є два варіанти. Зараз напишу."
    => proposedAction=DEFER_INCOMPLETE

    Messages:
    "API cache stores the whole response and breaks personalized fields."
    "There are two alternatives; I will write them next."
    => proposedAction=DEFER_INCOMPLETE

    Messages:
    "Deploy перенесли на четвер через Stripe."
    "Checkout лишається за feature flag; решту релізу катимо незалежно."
    "Migration запускаємо в середу ввечері; у четвер checkout після Stripe."
    => proposedAction=SUMMARIZE

    Messages:
    "Consumers require schemaVersion; unknown versions go to quarantine."
    "Legacy events temporarily receive v1 at the gateway and are replayed."
    "Remove the fallback after old lag is zero and quarantine stays empty."
    => proposedAction=SUMMARIZE

    Message:
    "Tomorrow after work I will buy chicken, rice, and vegetables at Novus. First I must collect a Nova Poshta parcel before 19:00; if I miss the deadline, I will collect it Thursday, but still buy the groceries tomorrow. After the shop I will visit Oleh for the drill because I need it Saturday to hang a kitchen shelf."
    => durable=true, alreadyCompact=false, requiresSynthesis=true, proposedAction=SUMMARIZE

    Messages:
    "Tomorrow after work I will buy chicken, rice, and vegetables at Novus."
    "First I must collect a Nova Poshta parcel before 19:00; if I miss the deadline, I will collect it Thursday, but still buy the groceries tomorrow."
    "After the shop I will visit Oleh for the drill because I need it Saturday to hang a kitchen shelf."
    => durable=true, alreadyCompact=false, requiresSynthesis=true, proposedAction=SUMMARIZE

    The preceding two examples carry the same semantic plan and therefore receive the same predicates despite different message boundaries.

    Do not infer missing context or turn hypotheses, jokes, or reactions into facts.
*/

//                   VISIBLE WINDOW
//                          ▼
//              Extract semantic predicates
//                          ▼
//                    Is durable?
//                 ┌────────┴────────┐
//                YES               NO
//                 │                 ├── only reactions?
//                 │                 │       └─► REACTION ANCHOR
//                 │                 ├── primarily banter?
//                 │                 │       └─► SOCIAL ANCHOR
//                 │                 └── vague topic/assessment?
//                 │                         └─► TOPIC ANCHOR
//     essential referents resolved?
//         ┌───────┴───────┐
//        NO              YES
//         ▼               ▼
//  CONTEXT ANCHOR     visibly incomplete?
//                     ┌─────┴─────┐
//                    YES         NO
//                     ▼           ▼
//              OPEN-THREAD    already compact?
//                ANCHOR       ┌────┴────┐
//                            YES       NO
//                             ▼         ▼
//                       COMPACT      requires
//                        ANCHOR      synthesis?
//                                   ┌───┴───┐
//                                  YES     NO
//                                   ▼       ▼
//                                SUMMARY  COMPACT
//                                         ANCHOR
