/**
 * Upper bound for every model-facing conversation window.
 *
 * A Worker can load a full chat history cheaply, but sending hundreds of
 * messages to the classifier/summarizer creates an unbounded model request
 * that can monopolize the single-message Queue consumer.  The selector keeps
 * this cap while preserving chronological, checkpoint-safe batching.
 */
export const MAX_MESSAGES = 128;

export const DAY_MS = 86_400_000;
