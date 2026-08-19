import type { SegmentReconstruction } from "@microsonya/discourse";

/** Legacy deterministic claim view for diagnostics, not the Telegram response. */
export function renderClaimsDebugView(
  segments: readonly SegmentReconstruction[],
): string {
  return segments
    .flatMap((segment) => segment.reconstruction.claims)
    .map((claim) => `• [${claim.topic}] ${claim.text}`)
    .join("\n");
}
