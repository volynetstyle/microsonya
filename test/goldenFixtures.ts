export type ExpectedAction =
  | "SUMMARIZE"
  | "DEFER_COMPACT"
  | "DEFER_INCOMPLETE"
  | "DEFER_CONTEXT"
  | "SKIP_REACTIONS"
  | "SKIP_BANTER"
  | "SKIP_NO_VALUE"
  | "EMPTY";

export interface E2EFixture {
  readonly id: string;
  readonly source: "exact" | "live" | "reconstructed";
  readonly scope?: "semantic" | "system";
  readonly status?: "accepted" | "under_review";
  readonly messages: readonly string[];
  readonly expected: {
    readonly action: ExpectedAction;
    /** Product-safe alternatives. The preferred action remains `action`. */
    readonly acceptableActions?: readonly ExpectedAction[];
    readonly summary?: {
      readonly mustInclude?: readonly string[];
      readonly mustExclude?: readonly string[];
      readonly mustNotInvent?: readonly string[];
      readonly preserveRelations?: readonly string[];
      readonly exactInvariants?: readonly string[];
      readonly propositions?: readonly {
        readonly subject: string;
        readonly relation: string;
        readonly object: string;
      }[];
    };
    readonly checkpoint?: { readonly advance: boolean };
  };
}

const fixture = (value: E2EFixture): E2EFixture => Object.freeze(value);

export const goldenFixtures = [
  fixture({
    id: "reactions-only",
    source: "exact",
    messages: ["ахахах", "😭😭", "жесть", "💀"],
    expected: { action: "SKIP_REACTIONS", checkpoint: { advance: true } },
  }),
  fixture({
    id: "banter-70k-pc",
    source: "exact",
    messages: ["70к за комп ахахаха", "💀", "це піздец", "ну зато красивий"],
    expected: { action: "SKIP_BANTER", checkpoint: { advance: true } },
  }),
  fixture({
    id: "durable-70k-pc-story",
    source: "exact",
    status: "under_review",
    messages: [
      "Her grandfather insisted, so the seller assembled a 70k PC anyway.",
      "Only 12k of that price is the graphics card; we suggested returning the parts and rebuilding it.",
      "ахах, прекрасно її намахали",
    ],
    expected: {
      action: "SUMMARIZE",
      acceptableActions: ["SUMMARIZE", "DEFER_COMPACT"],
      summary: {
        mustInclude: ["70к", "12к", "повернути комплектуючі"],
        mustExclude: ["жарт як окремий змістовний факт"],
        exactInvariants: ["70к", "12к"],
        propositions: [
          {
            subject: "PC components",
            relation: "recommendation",
            object: "return and rebuild",
          },
        ],
      },
      checkpoint: { advance: true },
    },
  }),
  fixture({
    id: "no-value-vague-change",
    source: "exact",
    messages: ["ну таке", "може треба щось поміняти"],
    expected: { action: "SKIP_NO_VALUE", checkpoint: { advance: true } },
  }),
  fixture({
    id: "no-value-vague-change-en",
    source: "exact",
    messages: [
      "We need to change something.",
      "Maybe; it is not very good now.",
    ],
    expected: { action: "SKIP_NO_VALUE" },
  }),
  fixture({
    id: "compact-deploy-stripe",
    source: "exact",
    messages: [
      "Deploy moved to Thursday.",
      "Stripe production access is pending.",
    ],
    expected: { action: "DEFER_COMPACT", checkpoint: { advance: false } },
  }),
  fixture({
    id: "compact-renderer-invariants",
    source: "exact",
    messages: [
      "Renderer invariants: framework does not own state; core imports no UI framework or DOM; UI uses an adapter; renderer is replaceable.",
    ],
    expected: { action: "DEFER_COMPACT", checkpoint: { advance: false } },
  }),
  fixture({
    id: "missing-context-option",
    source: "exact",
    messages: [
      "He agreed.",
      "Not to option two, to the one discussed yesterday.",
    ],
    expected: { action: "DEFER_CONTEXT", checkpoint: { advance: false } },
  }),
  fixture({
    id: "missing-context-option-uk",
    source: "exact",
    messages: [
      "Він погодився.",
      "Не на другий варіант, а на той, що обговорювали вчора.",
      "До п’ятниці має бути готово.",
    ],
    expected: {
      action: "DEFER_CONTEXT",
      summary: {
        mustNotInvent: [
          "хто саме погодився",
          "що таке варіант",
          "що саме має бути готове",
        ],
      },
      checkpoint: { advance: false },
    },
  }),
  fixture({
    id: "incomplete-memory-leak",
    source: "exact",
    messages: [
      "I found the memory leak.",
      "It seems subscriptions are not disposed.",
      "I am checking with a heap snapshot.",
    ],
    expected: {
      action: "DEFER_INCOMPLETE",
      summary: {
        mustNotInvent: [
          "subscriptions definitely cause the leak",
          "heap snapshot confirmed the hypothesis",
        ],
      },
      checkpoint: { advance: false },
    },
  }),
  fixture({
    id: "incomplete-api-cache-options",
    source: "exact",
    messages: [
      "Треба змінити схему кешування API: весь response ламає персоналізовані поля.",
      "Є два варіанти. Зараз напишу.",
    ],
    expected: {
      action: "DEFER_INCOMPLETE",
      summary: {
        mustInclude: ["кешування всього response ламає персоналізовані поля"],
        mustNotInvent: ["два ще не названі варіанти"],
      },
      checkpoint: { advance: false },
    },
  }),
  fixture({
    id: "summarize-staged-deploy",
    source: "exact",
    messages: [
      "Deploy перенесли на четвер через Stripe.",
      "Checkout лишається за feature flag; решту релізу катимо незалежно.",
      "Migration запускаємо в середу ввечері; у четвер checkout після Stripe.",
    ],
    expected: {
      action: "SUMMARIZE",
      summary: {
        mustInclude: ["четвер", "feature flag", "середу ввечері"],
        preserveRelations: ["Stripe блокує checkout, а не весь реліз"],
      },
      checkpoint: { advance: true },
    },
  }),
  fixture({
    id: "summarize-rollout-threshold",
    source: "exact",
    status: "under_review",
    messages: [
      "Tomorrow we test 10% of traffic. If mismatches exceed 0.1%, we roll back; otherwise we expand to 50%.",
    ],
    expected: {
      action: "SUMMARIZE",
      summary: {
        mustInclude: ["10%", "0.1%", "rollback", "50%"],
        exactInvariants: ["10%", "0.1%", "50%"],
        propositions: [
          {
            subject: "rollout",
            relation: "rollback_condition",
            object: "mismatch > 0.1%",
          },
          {
            subject: "rollout",
            relation: "expansion_condition",
            object: "otherwise expand to 50%",
          },
        ],
        preserveRelations: ["rollback condition is > 0.1%"],
      },
      checkpoint: { advance: true },
    },
  }),
  fixture({
    id: "summarize-schema-fallback-lifecycle",
    source: "exact",
    messages: [
      "Consumers require schemaVersion; unknown versions go to quarantine.",
      "Legacy events temporarily receive v1 at the gateway and are replayed.",
      "Remove the fallback after old lag is zero and quarantine stays empty.",
    ],
    expected: {
      action: "SUMMARIZE",
      acceptableActions: ["SUMMARIZE", "DEFER_COMPACT"],
      summary: {
        mustInclude: [
          "schemaVersion",
          "quarantine",
          "v1",
          "replayed",
          "old lag is zero",
        ],
        preserveRelations: ["fallback removal has two conditions"],
      },
      checkpoint: { advance: true },
    },
  }),
  fixture({
    id: "live-casual-high-information-minecraft",
    source: "live",
    messages: [
      "Notion AI створив і налаштував таблицю для класифікації Minecraft-модів.",
      "Після видалення двох dimension-модів RAM зменшилась приблизно з 4 ГБ до 3 ГБ.",
      "Після відходу техопа команда займається інфраструктурою.",
      "Губка Боб де? У ванній",
      "гпт вимре нахой.",
    ],
    expected: {
      action: "SUMMARIZE",
      acceptableActions: ["SUMMARIZE", "DEFER_COMPACT"],
      summary: {
        mustInclude: ["Notion AI", "4 ГБ", "3 ГБ", "інфраструктурою"],
        mustExclude: ["Губка Боб", "GPT скоро вимре"],
        mustNotInvent: ["усі додаткові виміри значно збільшують RAM"],
      },
      checkpoint: { advance: true },
    },
  }),
  fixture({
    id: "live-prod-version-vs-time",
    source: "live",
    messages: [
      "Знайшов, чому падає прод. Зараз перевіряю, чи це race condition, скину результат",
      "rollback зробили на 1.8.4, прод живий",
      "Якщо deploy до 18 не пройде, rollback на v2; якщо пройде, міграцію запускаємо завтра",
    ],
    expected: {
      action: "SUMMARIZE",
      summary: {
        mustInclude: ["1.8.4", "до 18", "v2", "міграцію"],
        mustNotInvent: ["deploy до версії 1.8", "race condition підтверджено"],
        preserveRelations: [
          "18 is a deadline/time-like value, not version 1.8",
        ],
      },
      checkpoint: { advance: true },
    },
  }),
  fixture({
    id: "checkpoint-single-banter-after-summary",
    source: "live",
    messages: ["Бо то робив кацап."],
    expected: {
      action: "SKIP_BANTER",
      acceptableActions: ["SKIP_BANTER", "SKIP_NO_VALUE"],
      checkpoint: { advance: true },
    },
  }),
  fixture({
    id: "checkpoint-no-new-messages",
    source: "exact",
    messages: [],
    expected: { action: "EMPTY", checkpoint: { advance: false } },
  }),
  fixture({
    id: "long-fictional-spongebob-story",
    source: "reconstructed",
    messages: [
      "Одного дня ти прийдеш на роботу й привітаєшся з Губкою Бобом на столі...",
      "Потім побачиш Губку Боба у ванній...",
      "довгий абсурдний офісний хорор-жарт",
      "ахахах",
      "💀",
    ],
    expected: {
      action: "SKIP_BANTER",
      summary: {
        mustNotInvent: [
          "реальну подію з Губкою Бобом",
          "реальну проблему в офісі",
        ],
      },
      checkpoint: { advance: true },
    },
  }),
  fixture({
    id: "banter-with-durable-technical-island",
    source: "reconstructed",
    messages: [
      "ахахаха ну ти геній",
      "💀",
      "Cache invalidation зараз робиться тільки по userId, тому shared entries залишаються stale після update.",
      "блять прекрасно",
    ],
    expected: {
      action: "SUMMARIZE",
      acceptableActions: ["SUMMARIZE", "DEFER_COMPACT"],
      summary: {
        mustInclude: ["userId", "shared entries", "stale"],
        mustExclude: ["реакції"],
      },
    },
  }),
  fixture({
    id: "wordplay-only-banter",
    source: "reconstructed",
    messages: [
      "Кнопка виклику Насті...",
      "поножовщину",
      "помяужовщину",
      "пономявщину",
      "поцарапщину",
    ],
    expected: { action: "SKIP_BANTER", checkpoint: { advance: true } },
  }),
  fixture({
    id: "reply-crosses-checkpoint",
    source: "reconstructed",
    scope: "system",
    messages: [
      "#100 Backend deploy is blocked by migration 42.",
      "#117 ^100 Міграцію вже закінчили, deploy можна запускати.",
    ],
    expected: {
      action: "SUMMARIZE",
      summary: {
        mustInclude: ["міграцію завершено", "deploy можна запускати"],
        preserveRelations: [
          "new message replies to the older migration/deploy context",
        ],
      },
    },
  }),
  fixture({
    id: "forwarded-message-provenance",
    source: "reconstructed",
    messages: [
      "Andrii: Нам deploy завтра.",
      "[Forwarded from External Chat] Deploy скасовано через проблему з API.",
      "Andrii: Це не про наш сервіс, я просто переслав.",
    ],
    expected: {
      action: "SUMMARIZE",
      summary: {
        mustInclude: ["іншого сервісу"],
        mustNotInvent: [
          "наш deploy скасовано",
          "forwarded statement належить Andrii",
        ],
      },
    },
  }),
  fixture({
    id: "edited-message-latest-state",
    source: "reconstructed",
    scope: "system",
    messages: [
      "#200 17:00 Deploy буде о 18:00.",
      "#200 edited 17:05 Deploy переносимо на завтра.",
    ],
    expected: {
      action: "DEFER_COMPACT",
      summary: {
        mustInclude: ["deploy перенесено на завтра"],
        mustExclude: ["18:00 як актуальний стан"],
      },
    },
  }),
  fixture({
    id: "parallel-summary-idempotency",
    source: "reconstructed",
    scope: "system",
    messages: ["Deploy завершили.", "Міграція успішна."],
    expected: { action: "SUMMARIZE" },
  }),
  fixture({
    id: "provider-timeout",
    source: "reconstructed",
    scope: "system",
    messages: [
      "Deploy перенесли на четвер через Stripe.",
      "Migration запускаємо в середу.",
    ],
    expected: { action: "SUMMARIZE", checkpoint: { advance: false } },
  }),
] as const satisfies readonly E2EFixture[];

export const smokeE2E = [
  "reactions-only",
  "banter-70k-pc",
  "durable-70k-pc-story",
  "compact-deploy-stripe",
  "missing-context-option-uk",
  "incomplete-api-cache-options",
  "summarize-staged-deploy",
  "summarize-schema-fallback-lifecycle",
  "live-casual-high-information-minecraft",
  "live-prod-version-vs-time",
  "checkpoint-single-banter-after-summary",
  "checkpoint-no-new-messages",
] as const;

export const adversarialE2E = [
  "long-fictional-spongebob-story",
  "banter-with-durable-technical-island",
  "wordplay-only-banter",
  "reply-crosses-checkpoint",
  "forwarded-message-provenance",
  "edited-message-latest-state",
  "parallel-summary-idempotency",
  "provider-timeout",
] as const;
