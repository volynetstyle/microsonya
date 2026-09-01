import type { WmaChat, WmaChatOverview, WmaSummaryDetail } from "./contracts";
import { WmaApiError } from "./http";

export type WmaFixture = "demo" | "empty" | "error" | "loading";
export type WmaFixtureResource = "chats" | "overview" | "detail";

const now = Date.now();

const demoChats: readonly WmaChat[] = [
  {
    ref: "product-team",
    title: "Команда продукту",
    summaryCount: 8,
    lastSummaryAt: now - 1000 * 60 * 18,
  },
  {
    ref: "launch",
    title: "Запуск Microsonya",
    summaryCount: 4,
    lastSummaryAt: now - 1000 * 60 * 60 * 3,
  },
  {
    ref: "family",
    title: "Сімейний чат",
    summaryCount: 12,
    lastSummaryAt: now - 1000 * 60 * 60 * 24,
  },
];

const demoOverview: WmaChatOverview = {
  chat: { ref: "product-team", title: "Команда продукту" },
  stats: { summaryCount: 8, messageCount: 126 },
  summaries: [
    {
      id: "summary-latest",
      createdAt: now - 1000 * 60 * 18,
      messageCount: 24,
      preview:
        "Команда узгодила фінальний scope релізу, пріоритети QA та план поступового запуску.",
      summary:
        "Команда зафіксувала фінальний scope релізу: новий екран підсумків, надійні стани завантаження та прямий перехід до джерельних повідомлень.\n\nQA проходить у два етапи — спочатку критичні сценарії на iOS та Android, потім перевірка Telegram Desktop. Поступовий запуск починається після проходження release gate.",
    },
    {
      id: "summary-design",
      createdAt: now - 1000 * 60 * 60 * 4,
      messageCount: 17,
      preview:
        "Візуальний напрям спростили: менше декоративних карток, більше нативної ієрархії Telegram.",
      summary:
        "Дизайн рухається в бік спокійної Telegram-native ієрархії. Акцент залишається на читабельності підсумку, часовому контексті та швидкому доступі до повідомлень-джерел.",
    },
    {
      id: "summary-api",
      createdAt: now - 1000 * 60 * 60 * 28,
      messageCount: 31,
      preview:
        "API-контракти стабілізовані; окремий detail-запит зберігає перший екран легким.",
      summary:
        "Список чатів і overview залишаються компактними. Повні джерельні повідомлення завантажуються лише після явної дії користувача, тому перший екран не переносить зайві дані.",
    },
  ],
};

const demoDetail: WmaSummaryDetail = {
  id: "summary-latest",
  summary: demoOverview.summaries[0].summary,
  moments: [
    {
      id: "message-1",
      sentAt: now - 1000 * 60 * 42,
      author: "Олена",
      body: "Фіксуємо scope: polishing hot path, усі async-стани й окремий перегляд джерел. Решту переносимо в наступну ітерацію.",
    },
    {
      id: "message-2",
      sentAt: now - 1000 * 60 * 35,
      author: "Андрій",
      body: "Після мобільного QA проганяємо release gate і відкриваємо поступовий rollout для першої групи.",
    },
    {
      id: "message-3",
      sentAt: now - 1000 * 60 * 27,
      author: "Марко",
      body: "Додам перевірку темної теми, safe-area і reduced motion. Для loading/error/empty залишу стабільні dev-fixtures.",
    },
  ],
};

export function activeFixture(): WmaFixture | undefined {
  if (!import.meta.env.DEV || typeof location === "undefined") return;
  const value = new URLSearchParams(location.search).get("fixture");
  return value === "demo" ||
    value === "empty" ||
    value === "error" ||
    value === "loading"
    ? value
    : undefined;
}

export function fixtureResponse<T>(
  resource: WmaFixtureResource,
): Promise<T> | undefined {
  const fixture = activeFixture();
  if (!fixture) return;
  if (fixture === "loading") return new Promise<T>(() => undefined);
  if (fixture === "error")
    return Promise.reject(new WmaApiError(503, "Fixture service unavailable"));
  if (fixture === "empty") {
    if (resource === "chats") return Promise.resolve([] as T);
    if (resource === "overview")
      return Promise.resolve({
        chat: { ref: "empty", title: "Новий чат" },
        stats: { summaryCount: 0, messageCount: 0 },
        summaries: [],
      } as T);
    return Promise.resolve({ id: "empty", summary: "", moments: [] } as T);
  }
  if (resource === "chats") return Promise.resolve(demoChats as T);
  if (resource === "overview") return Promise.resolve(demoOverview as T);
  return Promise.resolve(demoDetail as T);
}
