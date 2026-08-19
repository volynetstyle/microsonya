/** Legacy discourse-event pipeline retained only for evals and research. */
export * from "./invariants.js";
export * from "./projection.js";
export * from "./reducer.js";
export * from "./salience.js";
export {
  discourseEventSchema,
  discourseReconstructionSchema,
  evidenceItemSchema,
  projectedSummarySchema,
  type DiscourseEvent,
  type DiscourseReconstruction,
  type DiscourseState,
  type EvidenceItem,
  type ProjectedSummary,
  type ProjectionDiagnostics,
} from "./types.js";
export { DISCOURSE_PROMPT_VERSION, buildDiscoursePrompt } from "./prompt.js";
export { PIPE_V3_LANGUAGE_GUIDE, serializePipeV3 } from "@microsonya/discourse";
