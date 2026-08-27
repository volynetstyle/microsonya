import type { E2EFixture } from "./goldenFixtures.js";

export type Placement = "front" | "middle" | "tail";
export type ExtractionDimension =
  | "required"
  | "relation"
  | "binding"
  | "epistemic";
export type ForbiddenDimension =
  | "unsupported"
  | "superseded"
  | "binding"
  | "epistemic";

export interface ExtractionFact {
  readonly id: string;
  readonly dimension: ExtractionDimension;
  readonly anyOf: readonly string[];
}

export interface ForbiddenFact {
  readonly id: string;
  readonly dimension: ForbiddenDimension;
  readonly anyOf: readonly string[];
}

export interface ExtractionFixture {
  readonly id: string;
  readonly semanticMessages: readonly string[];
  readonly required: readonly ExtractionFact[];
  readonly forbidden: readonly ForbiddenFact[];
}

export const EXTRACTION_PLACEMENTS = ["front", "middle", "tail"] as const;
export const mandatoryExtraction = [
  "long-multiple-corrections",
  "long-hypothesis-vs-confirmed-cause",
  "long-numeric-type-collision",
  "long-quoted-message-provenance",
  "long-frequency-vs-final-state",
] as const;

export const extractionFixtures: readonly ExtractionFixture[] = [
  {
    id: "long-buried-final-decision",
    semanticMessages: [
      "По API можна або Redis лишити, або локальний кеш.",
      "Локальний простіше, але між інстансами будуть різні значення.",
      "Ще можна взагалі нічого не кешувати.",
      "На проді найбільше часу йде на profile endpoint; там ще N+1.",
      "Кароче по кешу: залишаємо Redis.",
      "Кешуємо тільки public profile fields на 10 хвилин.",
      "Personalized fields не кешуємо.",
      "Інвалідація при update profile. Так, це фінально.",
    ],
    required: [
      fact(
        "redis",
        "required",
        "залишаємо redis",
        "залишити redis",
        "залишають redis",
        "redis залишається",
      ),
      fact(
        "public",
        "binding",
        "public profile fields",
        "публічні поля профілю",
      ),
      fact("ttl", "binding", "10 хвилин"),
      fact(
        "personalized",
        "binding",
        "personalized fields не кеш",
        "персоналізовані поля не кеш",
      ),
      fact(
        "invalidation",
        "relation",
        "інвалідація при update profile",
        "інвалідація кешу при оновленні профілю",
      ),
    ],
    forbidden: [
      forbidden("local-selected", "superseded", "обрали локальний кеш"),
      forbidden("no-cache", "superseded", "повністю відмовились від кеш"),
      forbidden(
        "deploy-confirmed",
        "unsupported",
        "deploy сьогодні підтверджено",
      ),
    ],
  },
  {
    id: "long-multiple-corrections",
    semanticMessages: [
      "Реліз поки ставимо на п'ятницю.",
      "По релізу зміна: не п'ятниця, четвер, бо партнер підтвердив доступ раніше.",
      "Сам реліз катимо в четвер. Checkout лишаємо вимкненим.",
      "Checkout вмикаємо в п'ятницю після smoke tests.",
      "Стоп, останнє уточнення: smoke tests робимо в четвер ввечері.",
      "Якщо вони зелені, checkout вмикаємо одразу в четвер.",
      "Якщо ні — переносимо checkout на п'ятницю. Оце фінальний план.",
    ],
    required: [
      fact(
        "release",
        "required",
        "реліз у четвер",
        "реліз запланований на четвер",
        "перенесли на четвер",
      ),
      fact(
        "flag",
        "relation",
        "checkout лишаємо вимкненим",
        "checkout залишають вимкненим",
        "checkout за feature flag",
      ),
      fact(
        "smoke",
        "required",
        "smoke tests у четвер ввечері",
        "smoke тестів у четвер ввечері",
      ),
      fact(
        "green",
        "relation",
        "якщо smoke tests",
        "якщо вони зелені",
        "якщо тести пройдуть успішно",
      ),
      fact("fallback", "relation", "якщо ні", "інакше", "у п'ятницю"),
    ],
    forbidden: [
      forbidden("old-release", "superseded", "реліз запланований на п'ятницю"),
      forbidden(
        "unconditional-friday",
        "superseded",
        "checkout вмикають у п'ятницю",
      ),
      forbidden(
        "unconditional-thursday",
        "superseded",
        "checkout вмикають у четвер",
      ),
    ],
  },
  {
    id: "long-hypothesis-vs-confirmed-cause",
    semanticMessages: [
      "Прод знову впав, 502 сиплеться з gateway.",
      "Підозрюю connection pool. Може race condition або Redis.",
      "Redis живий, CPU і memory нормальні, connection pool теж нормальний.",
      "Один request висить 30 секунд і чекає зовнішній billing API.",
      "Timeout wrapper після рефактору не abort'ить underlying request.",
      "Через це завислі requests тримають sockets.",
      "Додав abort: локально socket count перестає рости, на staging теж підтвердилось.",
      "Причина знайдена: timeout не abort'ив HTTP request. Race condition ні до чого.",
      "Hotfix уже на staging, на prod ще не викочували.",
    ],
    required: [
      fact(
        "cause",
        "epistemic",
        "timeout не abort",
        "не переривав http request",
        "не завершує abort підлеглий http запит",
      ),
      fact(
        "sockets",
        "relation",
        "тримають sockets",
        "накопичення sockets",
        "тримають сокети",
      ),
      fact(
        "confirmed",
        "epistemic",
        "локально",
        "локальній машині та на staging",
        "на staging",
      ),
      fact(
        "not-prod",
        "epistemic",
        "на prod ще не",
        "ще не викочено на prod",
        "продакшн ще ні",
        "на продакшн ще не випущено",
      ),
    ],
    forbidden: [
      forbidden(
        "race",
        "epistemic",
        "причина — race condition",
        "причиною був race condition",
      ),
      forbidden("redis", "epistemic", "причина — redis", "причиною був redis"),
      forbidden("pool", "epistemic", "причина — connection pool"),
      forbidden(
        "prod",
        "epistemic",
        "hotfix уже на prod",
        "виправлення на prod",
      ),
    ],
  },
  {
    id: "long-numeric-type-collision",
    semanticMessages: [
      "Зараз прод на 1.8.4. Версію 2.0 поки не чіпаємо.",
      "CPU після rollback 18%, до цього було близько 42%.",
      "Deploy перевіряємо до 18; якщо не зелений — відкочуємося на v2.",
      "О 18:30 ще раз дивимось метрики.",
      "Error rate у prod 1.8%, ціль нижче 0.5%; на staging 0.18%.",
      "Canary зараз 10%.",
      "Якщо error rate нижче 0.5% протягом 15 хвилин — піднімаємо canary до 50%.",
      "18 — це година, не версія. 1.8.4 — поточна версія. v2 — rollback target.",
    ],
    required: [
      fact(
        "version",
        "binding",
        "поточна версія 1.8.4",
        "прод на 1.8.4",
        "використовується версія 1.8.4",
        "продакшн версії 1.8.4",
      ),
      fact("deadline", "binding", "18 — це година", "дедлайн до 18"),
      fact("rollback", "binding", "v2", "rollback target"),
      fact(
        "error",
        "binding",
        "error rate у продакшн 1.8%",
        "error rate у prod 1.8%",
      ),
      fact("threshold", "relation", "нижче 0.5%", "ціль 0.5%"),
      fact(
        "canary",
        "binding",
        "canary зараз 10%",
        "canary розгортання наразі 10%",
        "canary деплой запущено на 10%",
      ),
      fact("expansion", "relation", "протягом 15 хвилин", "до 50%"),
    ],
    forbidden: [
      forbidden("version18", "binding", "версії 1.8 до 18"),
      forbidden("cpu18", "binding", "cpu 1.8%"),
      forbidden("error18", "binding", "error rate 18%"),
      forbidden("rollback2", "binding", "rollback о 2:00"),
    ],
  },
  {
    id: "long-quoted-message-provenance",
    semanticMessages: [
      "Що там із міграцією? Зараз скину.",
      "> Міграцію скасували, база не витримує навантаження.",
      "Це повідомлення з іншого проекту, до нашої міграції воно не стосується.",
      "У нас staging migration вже завершилась.",
      "Prod запускаємо завтра о 09:00.",
      "Таблиця users займає найдовше, але lock time в межах норми.",
      "Replica lag максимум 1.2 секунди, це прийнятно.",
      "Нашу міграцію не скасовуємо. План без змін: prod завтра о 09:00.",
    ],
    required: [
      fact(
        "staging",
        "epistemic",
        "staging migration заверш",
        "стейджинг завершено",
        "стаджингова міграція вже завершена",
      ),
      fact(
        "prod",
        "required",
        "продакшн запуск заплановано на завтра о 09 00",
        "продакшн міграція запланована на завтра о 09 00",
      ),
      fact("provenance", "binding", "іншого проекту", "їхнього проєкту"),
      fact(
        "not-cancelled",
        "epistemic",
        "не скасовуємо",
        "не скасовано",
        "план не змінюється",
        "повідомлення про скасування неактуальне",
      ),
    ],
    forbidden: [
      forbidden("cancelled", "binding", "нашу міграцію скасовано"),
      forbidden(
        "our-db",
        "binding",
        "наша база не витримує",
        "база нашого проекту не витримує",
      ),
    ],
  },
  {
    id: "long-frequency-vs-final-state",
    semanticMessages: [
      "Ліміт ставимо 100 requests/min. 100 має вистачити.",
      "Для free tier точно 100. Я теж за 100.",
      "У документації пишу 100, rate limiter і staging уже на 100.",
      "Benchmark показав burst до 130, але може залишимо 100.",
      "Стоп, product попросив 150 для free tier.",
      "Перерахував cost — 150 теж ок. З security погодили.",
      "Фінальне значення free tier: 150 requests/min. 100 більше неактуально.",
      "Для paid tier лишається 1000 requests/min.",
    ],
    required: [
      fact("free", "binding", "free tier", "150 requests/min"),
      fact("paid", "binding", "paid tier", "1000 requests/min"),
    ],
    forbidden: [
      forbidden(
        "old-free",
        "superseded",
        "free tier 100",
        "free-tier limit 100",
      ),
    ],
  },
  {
    id: "long-two-similar-services",
    semanticMessages: [
      "По auth-service Redis поки лишаємо; session cache невеликий.",
      "Profile-service інша історія: Redis уже став bottleneck.",
      "Local LRU на одному інстансі швидше, але consistency між replicas нема.",
      "Для auth це неприйнятно; для profile частина даних immutable.",
      "Не плутайте auth і profile.",
      "Auth: Redis залишається.",
      "Profile: прибираємо Redis для public metadata.",
      "Public metadata кешуємо локально на 5 хвилин.",
      "Private profile fields взагалі не кешуємо. Session data до profile-service не належить.",
    ],
    required: [
      fact("auth", "binding", "auth", "redis залишається"),
      fact("profile", "binding", "profile", "public metadata", "локально"),
      fact("ttl", "binding", "public metadata", "5 хвилин"),
      fact("private", "binding", "private profile fields", "не кеш"),
    ],
    forbidden: [
      forbidden("auth-local", "binding", "auth-service переходить на local"),
      forbidden("profile-session", "binding", "profile-service кешує session"),
      forbidden(
        "private-ttl",
        "binding",
        "private profile fields кешуються 5 хвилин",
      ),
    ],
  },
] as const;

const NOISE = [
  "ахах",
  "до речі хто сьогодні на дейлі?",
  "я каву пішов зроблю",
  "в мене IDE знову зависла",
  "скинь потім скрін",
  "ок",
  "💀",
  "це взагалі окрема історія",
] as const;

export function injectNoise(
  semanticMessages: readonly string[],
  every = 2,
  copies = 8,
): string[] {
  const out: string[] = [];
  for (const [index, message] of semanticMessages.entries()) {
    out.push(message);
    if ((index + 1) % every !== 0) continue;
    for (let offset = 0; offset < copies; offset += 1) {
      out.push(NOISE[(index + offset) % NOISE.length]!);
    }
  }
  return out;
}

export function expandExtractionFixture(
  fixture: ExtractionFixture,
  placement: Placement,
  noiseCount = 96,
): E2EFixture {
  const noise = Array.from(
    { length: noiseCount },
    (_, index) => NOISE[index % NOISE.length]!,
  );
  const half = Math.floor(noise.length / 2);
  const messages =
    placement === "front"
      ? [...fixture.semanticMessages, ...noise]
      : placement === "middle"
        ? [
            ...noise.slice(0, half),
            ...fixture.semanticMessages,
            ...noise.slice(half),
          ]
        : [...noise, ...fixture.semanticMessages];
  return {
    id: `${fixture.id}@${placement}`,
    source: "reconstructed",
    messages,
    expected: {
      action: "SUMMARIZE",
      summary: {
        mustInclude: fixture.required.map(({ anyOf }) => anyOf[0]!),
        mustExclude: fixture.forbidden.flatMap(({ anyOf }) => anyOf),
      },
      checkpoint: { advance: true },
    },
  };
}

function fact(
  id: string,
  dimension: ExtractionDimension,
  ...anyOf: string[]
): ExtractionFact {
  return { id, dimension, anyOf };
}

function forbidden(
  id: string,
  dimension: ForbiddenDimension,
  ...anyOf: string[]
): ForbiddenFact {
  return { id, dimension, anyOf };
}
