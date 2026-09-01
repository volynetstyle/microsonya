# WMA visual direction

## Product intent

The WMA is a reading surface, not a dashboard. The primary path is deliberately
short:

1. Pick a chat.
2. Read the newest summary immediately.
3. Open the source messages only when verification or context is needed.
4. Return to the chat list without relying on the host browser history.

## References

- [Telegram Mini Apps API](https://core.telegram.org/bots/webapps) — source of
  truth for theme variables, viewport height, safe areas and low-power host
  behavior.
- [Telegram: AI Summaries, New Design and More](https://telegram.org/blog/new-design-ai-summaries)
  — information-first summaries that remain visually part of Telegram instead
  of looking like a separate AI dashboard.
- [Connection meeting summaries](https://connection.app/) — a clear distinction
  between a concise summary and its full transcript.
- [Zivy](https://www.zivy.app/) — summary text stays close to the underlying
  conversation context instead of becoming a detached report.

These references are used as interaction and hierarchy inputs only. The WMA
keeps its own typography, Ukrainian copy, data model and Telegram theme
adaptation.

## Applied rules

- Telegram CSS variables remain the authority for color; application tokens add
  semantic roles and browser fallbacks.
- Headers stay stable while route data loads, so navigation never disappears.
- Shared primitives own their boundary geometry. Product-level styles may
  change content hierarchy, but must not replace the Accordion's contiguous
  item stack with independent card gaps, borders or shadows.
- The latest summary is expanded by default.
- Source messages are a vertical, untruncated reading stream. Horizontal cards
  were removed because they hid context and added swipe cost.
- Loading UI mirrors the final shapes: five chat rows, three summary cards and
  three source-message rows.
- Skeleton motion is opacity-only and is disabled for reduced-motion and
  low-performance Telegram clients.
- Empty and error states preserve the surrounding route structure and expose a
  local retry action.

## Visual state stories

Development fixtures are documented in
[`apps/cloudflare/src/wma/README.md`](../apps/cloudflare/src/wma/README.md).
They cover loaded, loading, empty and error states without adding a Storybook
runtime or sample data to the production bundle.
