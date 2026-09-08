import type { SummaryAction } from "@microsonya/shared";
import { z } from "zod";

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
export const classifierOutputSchema = z
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

export type ClassificationPredicates = z.infer<typeof classifierOutputSchema>;

/** Deterministic policy: semantic predicates are model evidence, action is code. */
export function decideFromPredicates(
  predicates: ClassificationPredicates,
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
