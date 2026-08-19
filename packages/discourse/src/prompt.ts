export const CLAIMS_PROMPT_VERSION = "v6";

export function buildClaimsPrompt(
  serializedMessages: string,
  representation: string,
  languageGuide?: string,
): string {
  const sections = [
    "Витягни з Telegram-розмови evidence-backed змістовні твердження для подальшого узагальнення.",
    "Твоя єдина задача — semantic extraction. Не пиши підсумок, заголовок або готову відповідь користувачеві.",
    "Створюй claim лише для змістовної інформації, яку варто зберегти для подальшого узагальнення. Не створюй claims для реакцій, повторів, привітань і несуттєвих деталей.",
    "Кожен claim має містити одну самостійну тезу. Не дроби кожну репліку механічно, але розділяй незалежні важливі тези.",
    "Зберігай авторство, хронологію, суттєві розбіжності та контекст явних reply-зв'язків.",
    "Не подавай думки, припущення, жарти, сарказм, гіперболу або ігрові події як встановлені факти.",
    "Evidence має містити мінімальний набір ID повідомлень, які безпосередньо підтверджують claim.",
    "Поверни тільки JSON точно такої форми:",
    JSON.stringify(
      {
        claims: [
          {
            topic: "Коротка назва теми",
            text: "Одне змістовне твердження зі збереженим авторством",
            evidence: [17],
          },
        ],
      },
      null,
      2,
    ),
    `Формат вхідних даних: ${representation}`,
  ];
  if (languageGuide) sections.push("Опис формату:", languageGuide);
  sections.push("Повідомлення:", serializedMessages);
  return sections.join("\n\n");
}
