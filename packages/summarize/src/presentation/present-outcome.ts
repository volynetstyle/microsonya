import type { WindowDisposition } from "@microsonya/shared";
import { DEFER_MESSAGES, SKIP_MESSAGES } from "./disposition-messages.js";

export function presentDisposition(disposition: WindowDisposition): string {
  switch (disposition.kind) {
    case "summarized":
      return disposition.summary.text;
    case "deferred":
      return DEFER_MESSAGES[disposition.reason];
    case "skipped":
      return SKIP_MESSAGES[disposition.reason];
  }
}
