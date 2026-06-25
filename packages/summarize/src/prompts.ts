import type { DiscussionSegment, SegmentSummary } from "@microsonya/shared";

export type RawSegmentSummary = {
  title: string;
  summary: string[];
  decisions: string[];
  openQuestions: string[];
  jokes: string[];
  mentionedPeople: string[];
  importance: 0 | 1 | 2 | 3;
};

export function buildSegmentPrompt(segment: DiscussionSegment): string {
  return [
    "Ти аналізуєш фрагмент групового чату і створюєш структурований підсумок.",
    "",
    "Правила:",
    "- Використовуй тільки інформацію з повідомлень.",
    "- Не вигадуй факти, наміри, емоції або рішення.",
    "- Якщо рішень немає, поверни порожній масив decisions.",
    "- Якщо відкритих питань немає, поверни порожній масив openQuestions.",
    "- Якщо жарти або меми не важливі для контексту, поверни порожній масив jokes.",
    "- mentionedPeople має містити тільки людей, яких прямо згадували або які брали участь у важливій частині обговорення.",
    "- summary має бути списком коротких фактів, а не одним абзацом.",
    "- importance: 0 = шум, 1 = незначне, 2 = корисне, 3 = важливе.",
    "",
    "Поверни тільки валідний JSON без markdown, без пояснень, без ```.",
    "",
    "Схема JSON:",
    JSON.stringify(
      {
        title: "короткий заголовок до 10 слів",
        summary: ["короткий факт 1", "короткий факт 2"],
        decisions: ["рішення, якщо було"],
        openQuestions: ["відкрите питання, якщо було"],
        jokes: ["важливий жарт або мем, якщо був"],
        mentionedPeople: ["ім'я або authorId"],
        importance: 0,
      },
      null,
      2,
    ),
    "",
    "Повідомлення:",
    formatSegmentMessages(segment),
  ].join("\n");
}

export function buildMergePrompt(summaries: SegmentSummary[]): string {
  return [
    "Ти створюєш короткий Telegram-підсумок групового чату на основі JSON-підсумків сегментів.",
    "",
    "Правила:",
    "- Об'єднай дублікати.",
    "- Залиш тільки важливе.",
    "- Не приписуй людям думки, яких немає у сегментах.",
    "- Якщо рішень немає, напиши: Рішень не зафіксовано.",
    "- Якщо відкритих питань немає, напиши: Відкритих питань не зафіксовано.",
    "- Не використовуй markdown-таблиці.",
    "- Стиль: коротко, природно, як Telegram-повідомлення.",
    "",
    "Формат:",
    "Заголовок",
    "",
    "• Ключовий пункт",
    "• Ключовий пункт",
    "",
    "Рішення:",
    "• ...",
    "",
    "Відкриті питання:",
    "• ...",
    "",
    "Висновок:",
    "короткий висновок",
    "",
    "JSON-підсумки сегментів:",
    JSON.stringify(summaries, null, 2),
  ].join("\n");
}

function formatSegmentMessages(segment: DiscussionSegment): string {
  return segment.messages
    .map((message) => {
      const date = formatMessageDate(message.date);
      const author = message.authorName?.trim() || message.authorId;
      const text = message.text?.trim() || "[non-text message]";

      return `[${date}] ${author}: ${text}`;
    })
    .join("\n");
}

function formatMessageDate(value: string | number | Date): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString();
}
