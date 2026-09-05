import type { DeferReason, SkipReason } from "@microsonya/shared";

export const DEFER_MESSAGES: Readonly<Record<DeferReason, string>> =
  Object.freeze({
    DEFER_COMPACT:
      "У цих повідомленнях є корисна інформація, але вона вже достатньо стисла. Залишаю її для наступного підсумку.",
    DEFER_INCOMPLETE:
      "Обговорення ще розвивається. Зачекаю на результат або уточнення, щоб підсумок був кориснішим.",
    DEFER_CONTEXT:
      "У видимих повідомленнях бракує контексту для надійного підсумку без здогадок. Залишаю їх для наступного вікна.",
  });

export const SKIP_MESSAGES: Readonly<Record<SkipReason, string>> =
  Object.freeze({
    SKIP_REACTIONS:
      "Тут переважно короткі реакції та підтвердження, тож окремий підсумок не створюю.",
    SKIP_BANTER:
      "Тут переважно невимушене спілкування без інформації, яку варто переносити в історію підсумків.",
    SKIP_NO_VALUE:
      "У цьому вікні поки немає достатньо конкретної інформації для корисного підсумку.",
  });
