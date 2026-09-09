/**
 * Reveals an already accepted summary in append-only presentation chunks.
 * This function never generates, validates, or returns canonical text.
 */
export function appendAcceptedSummary(
  target: { append(delta: string): void },
  text: string,
  chunkCodePoints = 24,
): void {
  if (!Number.isSafeInteger(chunkCodePoints) || chunkCodePoints <= 0) {
    throw new TypeError("Presentation chunk size must be a positive integer.");
  }

  const codePoints = [...text];
  for (let index = 0; index < codePoints.length; index += chunkCodePoints) {
    target.append(codePoints.slice(index, index + chunkCodePoints).join(""));
  }
}
