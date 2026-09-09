import type {
  SummaryCandidate,
  SummarySemanticReviewer,
} from "../packages/summarize/src/index.js";

/** For tests of storage/selection/presentation, where model judgment is out of scope. */
export const acceptingReviewer: SummarySemanticReviewer = {
  async review(candidate) {
    return {
      fragments: candidate.fragments.map((_, index) => ({
        index,
        failures: [],
      })),
    };
  },
};

export function candidateFixture(
  text: string,
  evidence = [1],
): SummaryCandidate {
  return { fragments: [{ text, evidence, subjects: [] }] };
}
