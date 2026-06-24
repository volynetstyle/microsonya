import type { DiscussionSegment, SegmentSummary } from "@microsonya/shared";

export function buildSegmentPrompt(segment: DiscussionSegment): string {
  return [
    "Ти підсумовуєш фрагмент групового чату.",
    "",
    "Завдання:",
    "1. Назви тему фрагмента.",
    "2. Стисло поясни, що обговорювали.",
    "3. Виділи рішення, якщо були.",
    "4. Виділи відкриті питання.",
    "5. Виділи жарти або меми, якщо вони важливі для контексту.",
    "6. Не вигадуй того, чого немає в повідомленнях.",
    "",
    "Формат відповіді: тільки JSON без markdown.",
    `Повідомлення:\n${formatSegmentMessages(segment)}`
  ].join("\n");
}

export function buildMergePrompt(summaries: SegmentSummary[]): string {
  return [
    "Зроби короткий Telegram-підсумок з JSON-підсумків сегментів.",
    "Формат має бути стислим: заголовок, кілька bullet points, рішення, відкриті питання, висновок.",
    "Не приписуй людям думки, яких немає у сегментах.",
    "",
    JSON.stringify(summaries, null, 2)
  ].join("\n");
}

function formatSegmentMessages(segment: DiscussionSegment): string {
  return segment.messages
    .map((message) => {
      const date = new Date(message.date).toISOString();
      return `[${date}] ${message.authorName || message.authorId}: ${message.text}`;
    })
    .join("\n");
}
