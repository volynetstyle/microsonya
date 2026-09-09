import type { WmaChat, WmaChatOverview, WmaSummaryDetail } from "./contracts";
import { WmaApiError } from "./http";

export type WmaFixture = "demo" | "empty" | "error" | "loading";
export type WmaFixtureResource = "chats" | "overview" | "detail";

const now = Date.now();

const demoMomentBodies = [
  "Фіксуємо scope: polishing hot path, усі async-стани й окремий перегляд джерел. Решту переносимо в наступну ітерацію.",

  "Після мобільного QA проганяємо release gate і відкриваємо поступовий rollout для першої групи.",

  "Додам перевірку темної теми, safe-area і reduced motion. Для loading/error/empty залишу стабільні dev-fixtures.",

  "Перевірив основний сценарій. На десктопі все стабільно, але на вузькому viewport картка починає стискати metadata швидше, ніж очікувалось.",

  "Є невеликий regression у navigation state після повернення зі сторінки деталей.",

  "Домовились не чіпати API-контракт у цьому релізі. Зміни структури response винесемо окремо, щоб не змішувати UI polish з backend migration.",

  "На iPhone з safe-area нижня панель виглядає нормально. На Android треба ще перевірити поведінку при відкритій клавіатурі та зміні viewport height.",

  "Loading state зараз занадто швидко блимає на локальному середовищі, тому додам fixture із контрольованою затримкою. Це дозволить нормально перевірити skeleton без ручного throttling.",

  "Знайшов причину стрибка layout: timestamp спочатку рендерився без зарезервованої ширини, а потім після форматування змінював геометрію рядка.",

  "Summary detail можна залишити без окремого route-level loader. Даних мало, а кеш overview уже містить більшу частину інформації.",

  "Перевірка пройшла.",

  "Цей текст навмисно трохи довший. Треба побачити, як картка поводиться на двох або трьох рядках і чи не з'являється дивний вертикальний gap між автором, timestamp та основним текстом.",

  "Для scroll restoration треба перевірити три сценарії: звичайне повернення назад, перехід між двома summary та повторне відкриття тієї самої summary після оновлення списку.",

  "Виявив, що sticky header працює правильно тільки поки контейнер не отримує власний overflow. Якщо overflow переносимо на внутрішню область, треба явно визначити scroll container.",

  "Залишив TODO біля virtualization. Для п'ятдесяти елементів вона очевидно не потрібна, але fixture має бути придатним і для перевірки сотень повідомлень пізніше.",

  "Текст.",

  "Поточний typography scale виглядає добре на 1440px, але на 1280px рядки стають трохи задовгими. Можливо, варто обмежити максимальну ширину body незалежно від ширини detail panel.",

  "Після зміни summary потрібно скидати локальний selection state. Інакше виділений source з попереднього summary залишається активним, хоча його вже немає в новому наборі даних.",

  "Перевірив keyboard navigation: Tab проходить усі інтерактивні елементи в правильному порядку. Escape поки нічого не робить, бо окремого modal state тут немає.",

  "Є питання по даті: relative time зручний у списку, але всередині деталей краще показувати абсолютний час хоча б у tooltip. Інакше через кілька днів інформація стає менш однозначною.",

  "Зробив fixture для помилки.",

  "На повільній мережі detail спочатку може отримати overview з кешу, а moments приїдуть пізніше. UI не повинен через це перемальовувати весь екран або скидати позицію scroll.",

  "Поточний варіант із одним scroll container мені подобається більше. Він простіший, передбачуваніший і не створює вкладених областей прокрутки, які на мобільних зазвичай перетворюються на маленьке UX-пекло.",

  "Для довгих повідомлень обов'язково перевірити перенесення URL, технічних ідентифікаторів та дуже довгих слів без пробілів.",

  "Наприклад, ось штучно довгий ідентифікатор: summary_processing_pipeline_execution_attempt_01J7ZP4JYQV89H8KX4M27NQWED. Він не повинен розширювати контейнер.",

  "Вирішили залишити animation тільки для появи контенту. Scroll position та розміри контейнера анімувати не будемо, бо це створює більше проблем, ніж користі.",

  "Reduced motion повністю прибирає transition.",

  "На високому екрані контенту недостатньо для scroll, тому ця fixture спеціально містить багато елементів різної висоти. Інакше тестування scroll перетворюється на захопливе пересування DevTools туди-сюди.",

  "Source preview має відкриватися без зміни ширини основної колонки. Якщо panel накладається поверх контенту, треба перевірити focus trap та повернення focus після закриття.",

  "Перевірив 200% zoom. Layout не розвалюється, хоча header займає суттєво більше вертикального простору.",

  "Ще один короткий запис.",

  "Потрібно додати regression test на випадок, коли summary існує, але moments порожній. Це валідний стан даних і він не повинен випадково виглядати як network error.",

  "Backend може повернути моменти не в хронологічному порядку, тому boundary має або гарантувати порядок контрактом, або frontend повинен явно сортувати sentAt перед рендером. Приховані припущення такого типу люблять жити роками.",

  "У цьому сценарії текст навмисно займає більше місця. Користувач описує проблему детально, додає контекст, пояснює попередні спроби вирішення і в кінці формулює конкретну дію. Такі повідомлення потрібні, щоб перевірити реальну висоту карток, а не тільки акуратні дизайнерські приклади з двох речень.",

  "QA підтвердив основний flow.",

  "Є невеликий visual mismatch між hover та keyboard focus. Focus ring має бути помітнішим і не залежати від hover background.",

  "При переході на detail URL напряму overview може ще не бути завантажений. Це окремий cold-start сценарій, який не можна випадково маскувати navigation cache.",

  "Після rollout першої групи дивимось error rate, latency та кількість невдалих відкриттів detail. Якщо метрики стабільні, збільшуємо частку користувачів.",

  "Найдовший fixture у наборі. Тут спеціально багато тексту, щоб отримати суттєво вищий блок і перевірити поведінку під час швидкого scroll. Користувач відкрив summary, прочитав кілька моментів, перейшов до джерела, повернувся назад і очікує опинитися приблизно там само, де був. Паралельно можуть догрузитися додаткові дані, змінитися формат timestamp або з'явитися secondary metadata. Жодна з цих подій не повинна різко пересувати viewport. Якщо позиція все ж змінюється, треба дивитися на layout shifts, висоту placeholder та момент заміни skeleton реальним контентом.",

  "Порожній стан перевірено окремо.",

  "Додам dev toggle, який дозволить перемикатися між 5, 50, 200 і 1000 moments без зміни fixture-файлу.",

  "При 50 елементах DOM ще абсолютно нормальний. Virtualization тут потрібна не для продуктивності як такої, а лише якщо реальні summary потенційно виростуть на порядок.",

  "Не забути перевірити scrollbar у dark theme.",

  "Коли текст містить\nпереноси рядків,\nбраузер має коректно зберігати форматування лише якщо ми цього реально хочемо через white-space.",

  "Ще одна перевірка з числами: rollout 10%, p95 184 ms, p99 412 ms, error rate 0.17%. Числовий контент часто має іншу візуальну щільність.",

  "Олена підтвердила, що scope більше не змінюємо до завершення QA.",

  "Андрій закрив blocker із navigation state. Причина була в тому, що локальний signal переживав зміну параметра route.",

  "Марко перевірив accessibility tree і прибрав зайві aria-label там, де visible text уже давав елементу нормальне accessible name.",

  "Release candidate готовий до внутрішнього rollout. Перед production залишились smoke test, перевірка telemetry та один прохід на реальному мобільному пристрої.",

  "Фінальний елемент fixture. Якщо ти дочитав scroll до цього місця вручну, значить компонент принаймні дозволяє дістатися донизу, що вже несподівано непоганий початок.",
] as const;

const demoAuthors = [
  "Олена",
  "Андрій",
  "Марко",
  "Софія",
  "Максим",
  "Ірина",
] as const;

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
  nextCursor: null,
};

const demoDetail: WmaSummaryDetail = {
  id: "summary-latest",
  summary: demoOverview.summaries[0].summary,
  moments: demoMomentBodies.map((body, index) => ({
    id: `message-${index + 1}`,
    sentAt: now - 1000 * 60 * (42 + index * 7),
    author: demoAuthors[index % demoAuthors.length],
    body,
  })),
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
  requestedFixture: string | null = activeFixture() ?? null,
): Promise<T> | undefined {
  const fixture =
    requestedFixture === "demo" ||
    requestedFixture === "empty" ||
    requestedFixture === "error" ||
    requestedFixture === "loading"
      ? requestedFixture
      : undefined;
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
        nextCursor: null,
      } as T);
    return Promise.resolve({ id: "empty", summary: "", moments: [] } as T);
  }
  if (resource === "chats") return Promise.resolve(demoChats as T);
  if (resource === "overview") return Promise.resolve(demoOverview as T);
  return Promise.resolve(demoDetail as T);
}
