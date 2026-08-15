import type { DiscourseEvent } from "./types.js";

export function isDecision(event: DiscourseEvent): boolean {
  return (
    event.action !== null &&
    event.commitment === "explicit" &&
    event.settled &&
    event.epistemicStatus === "accepted" &&
    event.literalness !== "ironic"
  );
}
