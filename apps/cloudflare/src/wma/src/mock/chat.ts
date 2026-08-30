// Mock data for the first vertical-slice prototype: one chat, a handful of
// topics, and enough moments per topic (~20-30 total) to test whether a
// hierarchy is faster to scan than one flat summary. Swap for the real
// /summarize output once the shape proves out.

export type Moment =
  | {
      type: 'text';
      id: string;
      time: string;
      title: string;
      body: string;
    }
  | {
      type: 'quote';
      id: string;
      time: string;
      title: string;
      body: string;
      author: string;
      quote: string;
    };

export type Topic = {
  id: string;
  title: string;
  messageCount: number;
  timeRange: string;
  preview: string;
  keyPointsCount: number;
  moments: readonly Moment[];
};

export type ChatSummary = {
  chatName: string;
  date: string;
  totalMessages: number;
  topics: readonly Topic[];
};

export const mockChat: ChatSummary = {
  chatName: 'Чат мікросонь',
  date: 'сьогодні',
  totalMessages: 428,
  topics: [
    {
      id: 'summarization',
      title: 'Обговорення саммаризації',
      messageCount: 34,
      timeRange: '14:52–15:31',
      preview: 'Каріна запропонувала перейти на пряме цитування замість переказу.',
      keyPointsCount: 3,
      moments: [
        {
          type: 'text',
          id: 'sum-1',
          time: '14:52',
          title: 'Проблема довгих summary',
          body: 'Каріна зауважила, що підсумки на 400+ повідомлень виходять сухими — губиться, хто саме що сказав.',
        },
        {
          type: 'text',
          id: 'sum-2',
          time: '14:58',
          title: 'Пропозиція розбити на теми',
          body: 'Андрій запропонував групувати повідомлення за темою розмови, а не показувати все одним блоком.',
        },
        {
          type: 'quote',
          id: 'sum-3',
          time: '15:13',
          title: 'Ідея з прямими цитатами',
          body: 'Каріна запропонувала не переказувати, а цитувати ключові репліки дослівно.',
          author: 'Каріна',
          quote:
            'Мене бісить, коли бот переказує моїми словами те, що я і так пам\'ятаю — краще покажи, що я реально написала.',
        },
        {
          type: 'text',
          id: 'sum-4',
          time: '15:15',
          title: 'Ієрархічне представлення',
          body: 'Андрій запропонував: тема → ключові моменти → повне повідомлення за кліком, без переходу на нову сторінку.',
        },
        {
          type: 'text',
          id: 'sum-5',
          time: '15:19',
          title: 'Питання про продуктивність',
          body: 'Марко запитав, чи не буде рендер важким при 400+ повідомленнях, якщо все зберігати в DOM одразу.',
        },
        {
          type: 'text',
          id: 'sum-6',
          time: '15:24',
          title: 'Рішення: лінива підвантаження',
          body: 'Вирішили підвантажувати повні тексти моментів лише при розкритті — колапс тримає тільки прев\'ю.',
        },
        {
          type: 'quote',
          id: 'sum-7',
          time: '15:28',
          title: 'Головна гіпотеза експерименту',
          body: 'Андрій сформулював, що саме перевіряємо цим прототипом.',
          author: 'Андрій',
          quote:
            'Питання не в красі, а в швидкості: чи людина швидше зорієнтується в 400 повідомленнях через ієрархію, ніж через один суцільний підсумок.',
        },
        {
          type: 'text',
          id: 'sum-8',
          time: '15:31',
          title: 'Домовились про перший зріз',
          body: 'Один екран, mock-дані на 20-30 вузлів, expand/collapse на місці — без переходу на окрему сторінку.',
        },
      ],
    },
    {
      id: 'moving',
      title: 'Переїзд',
      messageCount: 61,
      timeRange: '16:04–17:40',
      preview: 'Обговорювали квартиру біля метро та дату переїзду.',
      keyPointsCount: 4,
      moments: [
        {
          type: 'text',
          id: 'mov-1',
          time: '16:04',
          title: 'Квартира біля метро',
          body: 'Оля скинула оголошення — однокімнатна за 5 хвилин від метро, поверх нормальний.',
        },
        {
          type: 'text',
          id: 'mov-2',
          time: '16:11',
          title: 'Питання про ціну',
          body: 'Дмитро запитав, чи входить комуналка в ціну, чи окремо.',
        },
        {
          type: 'text',
          id: 'mov-3',
          time: '16:22',
          title: 'Дата перегляду',
          body: 'Домовились подивитись квартиру у суботу вранці, до обіду.',
        },
        {
          type: 'quote',
          id: 'mov-4',
          time: '16:47',
          title: 'Сумніви щодо району',
          body: 'Оля висловила побоювання щодо шуму з проспекту.',
          author: 'Оля',
          quote:
            'Була там ввечері — траса реально гуде, треба перевірити з зачиненими вікнами, а не тільки вдень.',
        },
        {
          type: 'text',
          id: 'mov-5',
          time: '17:02',
          title: 'Альтернативний варіант',
          body: 'Марко знайшов другий варіант — далі від метро, але тихіше і дешевше.',
        },
        {
          type: 'text',
          id: 'mov-6',
          time: '17:18',
          title: 'Порівняння двох варіантів',
          body: 'Обговорили компроміс між ціною, шумом і відстанню до метро.',
        },
        {
          type: 'text',
          id: 'mov-7',
          time: '17:29',
          title: 'Попереднє рішення',
          body: 'Схилилися до тихішого варіанту, остаточне рішення — після суботнього перегляду.',
        },
        {
          type: 'text',
          id: 'mov-8',
          time: '17:40',
          title: 'Дата переїзду',
          body: 'Якщо все ок, переїзд запланували на кінець місяця.',
        },
      ],
    },
    {
      id: 'other',
      title: 'Інше',
      messageCount: 333,
      timeRange: '09:15–23:47',
      preview: 'Меми, короткі репліки, побутові питання без окремої теми.',
      keyPointsCount: 2,
      moments: [
        {
          type: 'text',
          id: 'oth-1',
          time: '09:15',
          title: 'Ранкові меми',
          body: 'Кілька мемів про понеділок і каву, без реакції на тему чату.',
        },
        {
          type: 'text',
          id: 'oth-2',
          time: '12:03',
          title: 'Питання про вечерю',
          body: 'Дмитро запитав, хто що готує на вечір п\'ятниці.',
        },
        {
          type: 'text',
          id: 'oth-3',
          time: '18:52',
          title: 'Посилання на статтю',
          body: 'Марко скинув статтю про SolidJS без коментаря — ніхто не відповів.',
        },
        {
          type: 'text',
          id: 'oth-4',
          time: '20:31',
          title: 'Коротке "дякую"',
          body: 'Оля подякувала за допомогу з переглядом квартири вранці.',
        },
        {
          type: 'text',
          id: 'oth-5',
          time: '23:47',
          title: 'Побажання доброї ночі',
          body: 'Кілька коротких реплік перед сном, без розвитку теми.',
        },
      ],
    },
  ],
};
