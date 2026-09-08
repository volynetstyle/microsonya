import type { SummaryOutputMode } from "./prompt.js";

/**
 * Compact contrasts derived from the approved semantic regression fixtures.
 * They demonstrate the failure boundary instead of teaching a preferred style.
 */
export function buildSummaryContrastExamples(
  outputMode: SummaryOutputMode,
): string {
  const supportedFirst =
    "Реліз перенесли на четвер. Checkout увімкнуть у четвер за умови успішних smoke-тестів; інакше — у п'ятницю.";
  const unsupportedFirst =
    "Реліз заплановано на п'ятницю, а checkout безумовно ввімкнуть у четвер.";
  const supportedSecond =
    "Переслане повідомлення про скасування стосувалося іншого проєкту. Нашу міграцію не скасовано: staging завершено, production заплановано на завтра.";
  const unsupportedSecond =
    "Нашу міграцію скасовано, бо наша база не витримує навантаження.";
  const output = (summary: string) =>
    outputMode === "structured" ? JSON.stringify({ summary }) : summary;

  return `
SEMANTIC_CONTRAST_EXAMPLES_BEGIN

Example 1 — supersession and condition binding
Visible facts:
- The release was first proposed for Friday, then explicitly moved to Thursday.
- Checkout is enabled Thursday only if Thursday evening smoke tests pass;
  otherwise checkout moves to Friday.
Correct final output:
${output(supportedFirst)}
Incorrect final output:
${output(unsupportedFirst)}

Example 2 — provenance and attribution
Visible facts:
- A forwarded cancellation message came from another project.
- The visible conversation explicitly says it does not concern our migration.
- Our staging migration completed and our production migration remains planned.
Correct final output:
${output(supportedSecond)}
Incorrect final output:
${output(unsupportedSecond)}

SEMANTIC_CONTRAST_EXAMPLES_END
`.trim();
}
