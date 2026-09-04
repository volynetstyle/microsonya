import { createHash } from "node:crypto";
import { SUMMARIZER_PROFILE, type OllamaClient } from "@microsonya/model";
import {
  asClaimId,
  asMessageId,
  asParticipantId,
  asReferentId,
  type ClaimId,
  type ContentSource,
  type ConversationWindow,
  type EpistemicStatus,
  type NumericDimension,
  type SummaryPlan,
} from "@microsonya/shared";
import { z } from "zod";
import { ModelOutputError, parseModelOutput } from "./modelOutput.js";
import {
  buildModelPolicyPrompt,
  buildSummaryInputPrompt,
  buildWindowAuthorAliases,
  type ModelWindowMessageRole,
} from "./prompt.js";
import type { SummarizationTelemetryTrace } from "./telemetry.js";

export const SUMMARY_PLAN_SCHEMA_VERSION = "summary-plan-v0.1";

const referentKindSchema = z.enum([
  "shipment",
  "order",
  "purchase",
  "incident",
  "task",
  "other",
]);
const epistemicStatusSchema = z.enum([
  "established",
  "reported",
  "claimed",
  "speculated",
  "proposed",
  "conditional",
]);
const numericDimensionSchema = z.enum([
  "duration",
  "count",
  "frequency",
  "distance",
  "quantity",
  "other",
]);

/** Transport schema. Canonical identities are resolved only after parsing. */
export const summaryPlanOutputSchema = z
  .object({
    referents: z.array(
      z
        .object({
          id: z
            .string()
            .trim()
            .regex(/^r[1-9]\d*$/u),
          kind: referentKindSchema,
        })
        .strict(),
    ),
    claims: z.array(
      z
        .object({
          id: z
            .string()
            .trim()
            .regex(/^c[1-9]\d*$/u),
          referentId: z
            .string()
            .trim()
            .regex(/^r[1-9]\d*$/u)
            .nullable(),
          speaker: z
            .string()
            .trim()
            .regex(/^@[1-9]\d*$/u)
            .nullable(),
          source: z
            .string()
            .trim()
            .regex(/^\$[1-9]\d*$/u)
            .nullable(),
          proposition: z.string().trim().min(1),
          epistemicStatus: epistemicStatusSchema,
          numericFacts: z.array(
            z
              .object({
                value: z.number().finite(),
                unit: z.string().trim().min(1).nullable(),
                dimension: numericDimensionSchema,
              })
              .strict(),
          ),
          evidenceMessageIds: z.array(z.number().int().positive()).min(1),
        })
        .strict(),
    ),
    retainedClaimIds: z.array(
      z
        .string()
        .trim()
        .regex(/^c[1-9]\d*$/u),
    ),
  })
  .strict();

export const SUMMARY_PLAN_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["referents", "claims", "retainedClaimIds"],
  properties: {
    referents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind"],
        properties: {
          id: { type: "string", pattern: "^r[1-9][0-9]*$" },
          kind: {
            enum: [
              "shipment",
              "order",
              "purchase",
              "incident",
              "task",
              "other",
            ],
          },
        },
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "referentId",
          "speaker",
          "source",
          "proposition",
          "epistemicStatus",
          "numericFacts",
          "evidenceMessageIds",
        ],
        properties: {
          id: { type: "string", pattern: "^c[1-9][0-9]*$" },
          referentId: { type: ["string", "null"] },
          speaker: { type: ["string", "null"] },
          source: { type: ["string", "null"] },
          proposition: { type: "string", minLength: 1 },
          epistemicStatus: {
            enum: [
              "established",
              "reported",
              "claimed",
              "speculated",
              "proposed",
              "conditional",
            ],
          },
          numericFacts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["value", "unit", "dimension"],
              properties: {
                value: { type: "number" },
                unit: { type: ["string", "null"] },
                dimension: {
                  enum: [
                    "duration",
                    "count",
                    "frequency",
                    "distance",
                    "quantity",
                    "other",
                  ],
                },
              },
            },
          },
          evidenceMessageIds: {
            type: "array",
            minItems: 1,
            items: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    retainedClaimIds: {
      type: "array",
      items: { type: "string", pattern: "^c[1-9][0-9]*$" },
    },
  },
} as const);

export interface SummaryPlanExtractor {
  extract(
    window: ConversationWindow,
    signal?: AbortSignal,
    telemetry?: SummarizationTelemetryTrace,
    roles?: readonly ModelWindowMessageRole[],
  ): Promise<SummaryPlan>;
}

export function createSummaryPlanExtractor(deps: {
  readonly ollama: Pick<OllamaClient, "chat">;
}): SummaryPlanExtractor {
  return {
    extract: async (window, signal, telemetry, roles) => {
      const messages = buildSummaryPlanMessages(window, roles);
      const prompt = messages.map(({ content }) => content).join("\n\n");
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        signal?.throwIfAborted();
        telemetry?.record({
          type: "model.request",
          stage: "planner",
          model: SUMMARIZER_PROFILE.model,
          attempt,
          messageCount: window.messages.length,
          promptChars: prompt.length,
          prompt,
        });
        const startedAt = performance.now();
        const response = await deps.ollama.chat(
          {
            ...SUMMARIZER_PROFILE,
            options: { ...SUMMARIZER_PROFILE.options, temperature: 0 },
            // Cloud structured-output support is not a correctness boundary.
            // JSON.parse, Zod, and validateSummaryPlan below are authoritative.
            stream: false,
            messages,
          },
          { signal },
        );
        signal?.throwIfAborted();
        const durationMs = performance.now() - startedAt;
        telemetry?.record({
          type: "model.response.envelope",
          stage: "planner",
          model: SUMMARIZER_PROFILE.model,
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
          const wire = parseModelOutput({
            raw: response.message.content,
            schema: summaryPlanOutputSchema,
            stage: "planner",
            model: SUMMARIZER_PROFILE.model,
            durationMs,
            attempt,
            telemetry,
          });
          const plan = validateSummaryPlan(
            resolveSummaryPlan(wire, window),
            window,
          );
          telemetry?.record({
            type: "model.response",
            stage: "planner",
            model: SUMMARIZER_PROFILE.model,
            attempt,
            durationMs,
            responseChars: response.message.content.length,
          });
          telemetry?.record({
            type: "summary.plan.validated",
            schemaVersion: SUMMARY_PLAN_SCHEMA_VERSION,
            retryCount: attempt - 1,
            planHash: hashSummaryPlan(plan),
            claimCount: plan.claims.length,
            retainedClaimCount: plan.retainedClaimIds.length,
          });
          return plan;
        } catch (error) {
          if (
            (error instanceof ModelOutputError ||
              error instanceof SummaryPlanValidationError) &&
            attempt === 1
          ) {
            telemetry?.record({
              type: "model.request.retry",
              stage: "planner",
              model: SUMMARIZER_PROFILE.model,
              failedAttempt: attempt,
              nextAttempt: attempt + 1,
              reason:
                error instanceof ModelOutputError
                  ? error.code
                  : "MODEL_OUTPUT_SCHEMA_MISMATCH",
            });
            continue;
          }
          throw error;
        }
      }
      throw new Error("Summary plan retry loop exited without a valid plan.");
    },
  };
}

export function buildSummaryPlanMessages(
  window: ConversationWindow,
  roles?: readonly ModelWindowMessageRole[],
) {
  return [
    {
      role: "system" as const,
      content: buildModelPolicyPrompt(
        "SUMMARY_POLICY",
        SUMMARY_PLAN_EXTRACTION_INSTRUCTIONS,
      ),
    },
    {
      role: "user" as const,
      content: buildSummaryInputPrompt(window, roles),
    },
  ];
}

export class SummaryPlanValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "SummaryPlanValidationError";
  }
}

/** Dumb structural boundary: no language understanding or LLM judge. */
export function validateSummaryPlan(
  plan: SummaryPlan,
  window: ConversationWindow,
): SummaryPlan {
  const referentIds = uniqueIds(
    plan.referents.map(({ id }) => id),
    "referent",
  );
  const claimIds = uniqueIds(
    plan.claims.map(({ id }) => id),
    "claim",
  );
  const messageIds = new Set(window.messages.map(({ id }) => id as number));
  const participantIds = new Set(
    window.messages.map(({ author }) => author.id as string),
  );
  const sourceIds = new Set(
    window.messages.flatMap(({ contentSource }) =>
      contentSource === undefined ? [] : [contentSourceKey(contentSource)],
    ),
  );

  for (const claim of plan.claims) {
    if (claim.referentId !== undefined && !referentIds.has(claim.referentId)) {
      throw new SummaryPlanValidationError(
        `Claim ${claim.id} has a dangling referent.`,
      );
    }
    if (claim.speakerId !== undefined && !participantIds.has(claim.speakerId)) {
      throw new SummaryPlanValidationError(
        `Claim ${claim.id} has an invented speaker.`,
      );
    }
    if (claim.sourceId !== undefined && !sourceIds.has(claim.sourceId)) {
      throw new SummaryPlanValidationError(
        `Claim ${claim.id} has an invented source.`,
      );
    }
    if (
      claim.sourceId !== undefined &&
      claim.epistemicStatus === "established"
    ) {
      throw new SummaryPlanValidationError(
        `Claim ${claim.id} upgrades sourced material to established fact.`,
      );
    }
    if (claim.evidenceMessageIds.length === 0) {
      throw new SummaryPlanValidationError(
        `Claim ${claim.id} has no evidence.`,
      );
    }
    for (const messageId of claim.evidenceMessageIds) {
      if (!messageIds.has(messageId)) {
        throw new SummaryPlanValidationError(
          `Claim ${claim.id} refers to message ${messageId} outside the window.`,
        );
      }
    }
    for (const fact of claim.numericFacts ?? []) validateNumericFact(fact);
  }

  uniqueIds(plan.retainedClaimIds, "retained claim");
  for (const retainedId of plan.retainedClaimIds) {
    if (!claimIds.has(retainedId)) {
      throw new SummaryPlanValidationError(
        `Retained claim ${retainedId} does not exist.`,
      );
    }
  }
  if (plan.retainedClaimIds.length === 0) {
    throw new SummaryPlanValidationError(
      "A summary plan must retain at least one claim.",
    );
  }

  return deepFreezePlan(plan);
}

export function hashSummaryPlan(plan: SummaryPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(plan), "utf8")
    .digest("hex");
}

export function contentSourceKey(source: ContentSource): string {
  return "sourceId" in source && source.sourceId !== undefined
    ? source.sourceId
    : `${source.kind}:${source.label}`;
}

type WireSummaryPlan = z.infer<typeof summaryPlanOutputSchema>;

function resolveSummaryPlan(
  wire: WireSummaryPlan,
  window: ConversationWindow,
): SummaryPlan {
  const authorTokenToId = new Map(
    [...buildWindowAuthorAliases(window)].map(([id, token]) => [token, id]),
  );
  const sourceTokenToId = new Map<string, string>();
  for (const message of window.messages) {
    if (message.contentSource === undefined) continue;
    const key = contentSourceKey(message.contentSource);
    if (![...sourceTokenToId.values()].includes(key)) {
      sourceTokenToId.set(`$${sourceTokenToId.size + 1}`, key);
    }
  }

  return {
    referents: wire.referents.map(({ id, kind }) => ({
      id: asReferentId(id),
      kind,
    })),
    claims: wire.claims.map((claim) => {
      const speakerId =
        claim.speaker === null ? undefined : authorTokenToId.get(claim.speaker);
      const sourceId =
        claim.source === null ? undefined : sourceTokenToId.get(claim.source);
      if (claim.speaker !== null && speakerId === undefined) {
        throw new SummaryPlanValidationError(
          `Unknown speaker token ${claim.speaker}.`,
        );
      }
      if (claim.source !== null && sourceId === undefined) {
        throw new SummaryPlanValidationError(
          `Unknown source token ${claim.source}.`,
        );
      }
      return {
        id: asClaimId(claim.id),
        ...(claim.referentId === null
          ? {}
          : { referentId: asReferentId(claim.referentId) }),
        ...(speakerId === undefined
          ? {}
          : { speakerId: asParticipantId(speakerId) }),
        ...(sourceId === undefined ? {} : { sourceId }),
        proposition: claim.proposition,
        epistemicStatus: claim.epistemicStatus,
        numericFacts: claim.numericFacts.map(({ value, unit, dimension }) => ({
          value,
          ...(unit === null ? {} : { unit }),
          dimension,
        })),
        evidenceMessageIds: claim.evidenceMessageIds.map(asMessageId),
      };
    }),
    retainedClaimIds: wire.retainedClaimIds.map(asClaimId),
  };
}

function uniqueIds<T extends string>(
  values: readonly T[],
  label: string,
): Set<T> {
  const result = new Set<T>();
  for (const value of values) {
    if (result.has(value)) {
      throw new SummaryPlanValidationError(`Duplicate ${label} id ${value}.`);
    }
    result.add(value);
  }
  return result;
}

function validateNumericFact(fact: {
  readonly value: number;
  readonly unit?: string;
  readonly dimension: NumericDimension;
}): void {
  if (!Number.isFinite(fact.value)) {
    throw new SummaryPlanValidationError("Numeric fact value must be finite.");
  }
  if (fact.unit !== undefined && fact.unit.trim().length === 0) {
    throw new SummaryPlanValidationError(
      "Numeric fact unit must be non-empty.",
    );
  }
  if (
    fact.unit !== undefined &&
    DURATION_UNITS.has(fact.unit.trim().toLocaleLowerCase("uk")) &&
    fact.dimension !== "duration"
  ) {
    throw new SummaryPlanValidationError(
      `Duration unit ${fact.unit} cannot use ${fact.dimension} dimension.`,
    );
  }
}

const DURATION_UNITS = new Set([
  "second",
  "seconds",
  "sec",
  "minute",
  "minutes",
  "min",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "секунда",
  "секунди",
  "секунд",
  "хвилина",
  "хвилини",
  "хвилин",
  "година",
  "години",
  "годин",
  "день",
  "дні",
  "днів",
  "тиждень",
  "тижні",
  "тижнів",
  "місяць",
  "місяці",
  "місяців",
  "рік",
  "роки",
  "років",
]);

function deepFreezePlan(plan: SummaryPlan): SummaryPlan {
  return Object.freeze({
    referents: Object.freeze(
      plan.referents.map((referent) => Object.freeze({ ...referent })),
    ),
    claims: Object.freeze(
      plan.claims.map((claim) =>
        Object.freeze({
          ...claim,
          numericFacts:
            claim.numericFacts === undefined
              ? undefined
              : Object.freeze(
                  claim.numericFacts.map((fact) => Object.freeze({ ...fact })),
                ),
          evidenceMessageIds: Object.freeze([...claim.evidenceMessageIds]),
        }),
      ),
    ),
    retainedClaimIds: Object.freeze([
      ...plan.retainedClaimIds,
    ]) as readonly ClaimId[],
  });
}

const SUMMARY_PLAN_EXTRACTION_INSTRUCTIONS = `
Extract a semantic SummaryPlan from the eligible messages. Return JSON only.
Do not write summary prose.

The exact object shape is:
{"referents":[{"id":"r1","kind":"shipment|order|purchase|incident|task|other"}],"claims":[{"id":"c1","referentId":"r1 or null","speaker":"@1 or null","source":"$1 or null","proposition":"atomic supported proposition","epistemicStatus":"established|reported|claimed|speculated|proposed|conditional","numericFacts":[{"value":3,"unit":"days or null","dimension":"duration|count|frequency|distance|quantity|other"}],"evidenceMessageIds":[1]}],"retainedClaimIds":["c1"]}

Use only window-local rN and cN identifiers. Use only visible @N speakers and $N
sources. AUTHOR and SOURCE are independent. A forwarded claim must keep SOURCE
and must be reported or claimed, never established merely because it appears in
the transcript. Explicit uncertainty must remain speculated. Requests and
proposals are not completed actions.

Keep distinct shipments, orders, purchases, incidents, and tasks as distinct
referents unless an explicit message links them. Adjacency is not linking
evidence. Preserve every numeric value, unit, and dimension. In particular,
three days is duration, never an occurrence count or ordinal shipment.

Retain the smallest useful set of durable claims. Omit jokes, wishes, reactions,
anxiety, drink preferences, and generic social filler unless they carry an
independent durable fact. Every retained claim must cite existing message IDs.
`.trim();
