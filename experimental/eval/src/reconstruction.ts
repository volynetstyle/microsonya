import { z } from "zod";
import type { Gold } from "./types.js";

export const reconstructionOutputSchema = z
  .object({
    threads: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          messages: z.array(z.number().int().positive()).min(1),
        })
        .strict(),
    ),
    unassigned: z.array(z.number().int().positive()),
  })
  .strict();

export type ReconstructionOutput = z.infer<typeof reconstructionOutputSchema>;

export type ReconstructionScore = {
  validJson: boolean;
  schemaValid: boolean;
  messageCoverage: number;
  unknownMessageIds: number;
  duplicateAssignments: number;
  pairwiseThreadPrecision: number | null;
  pairwiseThreadRecall: number | null;
  majorThreadRecall: number | null;
  bestThreadJaccardMean: number | null;
};

export function parseReconstruction(
  raw: string,
):
  | { ok: true; output: ReconstructionOutput }
  | { ok: false; validJson: boolean; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      validJson: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const parsed = reconstructionOutputSchema.safeParse(value);
  return parsed.success
    ? { ok: true, output: parsed.data }
    : { ok: false, validJson: true, error: parsed.error.message };
}

export function scoreReconstruction(
  output: ReconstructionOutput,
  gold: Gold,
  validIds: Set<number>,
): ReconstructionScore {
  const assignments = [
    ...output.threads.flatMap((thread) => thread.messages),
    ...output.unassigned,
  ];
  const knownAssignments = assignments.filter((id) => validIds.has(id));
  const predicted = output.threads.map(
    (thread) => new Set(thread.messages.filter((id) => validIds.has(id))),
  );
  const goldThreads = gold.threads.map((thread) => ({
    ...thread,
    messages: new Set(
      gold.claims
        .filter((claim) => claim.thread === thread.id)
        .flatMap((claim) => claim.evidence),
    ),
  }));
  const labeledIds = new Set(
    goldThreads.flatMap((thread) => [...thread.messages]),
  );
  const goldPairs = new Set(
    goldThreads.flatMap((thread) => pairs([...thread.messages]).map(pairKey)),
  );
  const predictedPairs = new Set(
    predicted.flatMap((thread) =>
      pairs([...thread].filter((id) => labeledIds.has(id))).map(pairKey),
    ),
  );
  const correctPairs = [...predictedPairs].filter((pair) =>
    goldPairs.has(pair),
  ).length;
  const jaccards = goldThreads
    .filter((thread) => thread.messages.size > 0)
    .map((thread) =>
      Math.max(
        0,
        ...predicted.map((cluster) => jaccard(thread.messages, cluster)),
      ),
    );
  const major = goldThreads.filter(
    (thread) => thread.weight >= 3 && thread.messages.size > 0,
  );

  return {
    validJson: true,
    schemaValid: true,
    messageCoverage: new Set(knownAssignments).size / validIds.size,
    unknownMessageIds: assignments.filter((id) => !validIds.has(id)).length,
    duplicateAssignments:
      knownAssignments.length - new Set(knownAssignments).size,
    pairwiseThreadPrecision:
      predictedPairs.size === 0 ? null : correctPairs / predictedPairs.size,
    pairwiseThreadRecall:
      goldPairs.size === 0 ? null : correctPairs / goldPairs.size,
    majorThreadRecall:
      major.length === 0
        ? null
        : major.filter((thread) =>
            predicted.some(
              (cluster) => jaccard(thread.messages, cluster) >= 0.5,
            ),
          ).length / major.length,
    bestThreadJaccardMean: jaccards.length === 0 ? null : mean(jaccards),
  };
}

export function emptyReconstructionScore(
  validJson = false,
): ReconstructionScore {
  return {
    validJson,
    schemaValid: false,
    messageCoverage: 0,
    unknownMessageIds: 0,
    duplicateAssignments: 0,
    pairwiseThreadPrecision: null,
    pairwiseThreadRecall: null,
    majorThreadRecall: null,
    bestThreadJaccardMean: null,
  };
}

function pairs(values: number[]): Array<[number, number]> {
  return values.flatMap((left, index) =>
    values.slice(index + 1).map((right) => [left, right] as [number, number]),
  );
}

function pairKey([left, right]: [number, number]): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function jaccard(left: Set<number>, right: Set<number>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...left].filter((id) => right.has(id)).length / union.size;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
