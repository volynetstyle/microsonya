import { z } from "zod";
import type { ConversationWindow } from "@microsonya/shared";
import type { SummaryExecutionRecorder } from "../execution/observer.js";
import { ModelOutputError } from "../model/output.js";
import type { ModelWindowMessageRole } from "../model/prompt.js";
import {
  acceptSummaryCandidate,
  composeSummary,
  SummaryAcceptanceError,
  validateSummaryCandidate,
} from "./acceptance.js";
import { acceptSummaryReview } from "./review.js";
import type { SummaryCandidate } from "./schema.js";
import type { SummaryRepair } from "./repair.js";
import type { SummarySemanticReviewer } from "./reviewer.js";
import type { ConversationSummarizer } from "./summarizer.js";

/** One shared repair budget across generation, L1 and L2. No classifier rerun. */
export async function generateAcceptedSummary(
  window: ConversationWindow,
  generator: ConversationSummarizer,
  reviewer: SummarySemanticReviewer,
  signal?: AbortSignal,
  execution?: SummaryExecutionRecorder,
  roles?: readonly ModelWindowMessageRole[],
): Promise<string> {
  let candidate: SummaryCandidate | undefined;
  let generationRepair: SummaryRepair | undefined;
  let reviewRepair: SummaryRepair | undefined;
  let generationAttempt = 1;
  let reviewAttempt = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    signal?.throwIfAborted();
    try {
      if (candidate === undefined) {
        candidate = validateSummaryCandidate(
          await generator.summarize(
            window,
            signal,
            execution,
            roles,
            generationRepair,
          ),
        );
      }
      signal?.throwIfAborted();
      acceptSummaryCandidate(candidate, window, roles);
      reviewAttempt += 1;
      const review = await reviewer.review(
        candidate,
        window,
        signal,
        execution,
        roles,
        reviewAttempt,
        reviewRepair,
      );
      signal?.throwIfAborted();
      acceptSummaryReview(review, candidate);
      return composeSummary(candidate);
    } catch (error) {
      signal?.throwIfAborted();
      if (
        !(
          error instanceof ModelOutputError ||
          error instanceof SummaryAcceptanceError
        )
      )
        throw error;
      const reviewerOutput =
        error instanceof ModelOutputError && error.stage === "reviewer.output";
      const stage = reviewerOutput ? "reviewer" : "summarizer";
      execution?.record({
        type: "summary.acceptance.rejected",
        stage,
        attempt: reviewerOutput ? reviewAttempt : generationAttempt,
        reason: error.code,
      });
      if (pass === 1) throw error;
      const repair: SummaryRepair = {
        raw:
          error instanceof ModelOutputError &&
          (candidate === undefined || reviewerOutput)
            ? error.raw
            : JSON.stringify(candidate),
        code: error.code,
        detail:
          error.cause instanceof z.ZodError
            ? JSON.stringify(
                error.cause.issues.map(({ path, message }) => ({
                  path,
                  message,
                })),
              )
            : error instanceof SummaryAcceptanceError
              ? error.detail
              : error.message,
        ...(error instanceof SummaryAcceptanceError
          ? { fragmentIndex: error.fragmentIndex }
          : {}),
      };
      execution?.record({
        type: "summary.repair.requested",
        stage,
        failedAttempt: reviewerOutput ? reviewAttempt : generationAttempt,
        nextAttempt: reviewerOutput ? reviewAttempt + 1 : generationAttempt + 1,
        reason: error.code,
      });
      if (reviewerOutput) {
        reviewRepair = repair;
      } else {
        candidate = undefined;
        generationRepair = repair;
        generationAttempt += 1;
        reviewRepair = undefined;
      }
    }
  }
  throw new Error("Summary repair budget exhausted without a result.");
}
