import type { Claim, SegmentReconstruction } from "@microsonya/discourse";

export type SummaryEpisode = { topic: string; claims: Claim[] };

export function buildSummaryEpisodes(
  segments: readonly SegmentReconstruction[],
): SummaryEpisode[] {
  const deduplicated = new Map<string, Claim>();
  for (const claim of segments.flatMap(
    (segment) => segment.reconstruction.claims,
  )) {
    const key = `${normalize(claim.topic)}\u0000${normalize(claim.text)}`;
    const existing = deduplicated.get(key);
    deduplicated.set(
      key,
      existing
        ? {
            ...existing,
            evidence: [
              ...new Set([...existing.evidence, ...claim.evidence]),
            ].sort((a, b) => a - b),
          }
        : claim,
    );
  }

  const episodes = new Map<string, SummaryEpisode>();
  for (const claim of [...deduplicated.values()].sort(byEvidence)) {
    const key = normalize(claim.topic);
    const episode = episodes.get(key) ?? { topic: claim.topic, claims: [] };
    episode.claims.push(claim);
    episodes.set(key, episode);
  }
  return [...episodes.values()];
}

export function buildFinalRenderPrompt(
  episodes: readonly SummaryEpisode[],
): string {
  return [
    "На основі наведених evidence-backed тверджень стисло перекажи розмову природною українською мовою.",
    "Ціль — minimum sufficient representation: стискай настільки, наскільки можливо без помітної втрати змісту.",
    "Об'єднуй деталі одного епізоду в одну зв'язну думку. Не переказуй послідовність реплік, якщо кілька повідомлень можна передати одним узагальненням.",
    "Не створюй lossy transcript із ланцюжка речень «Потім...», «Після цього...», «Обговорювали...», «Нарешті...». Переходь між змістовими епізодами, а не між окремими повідомленнями.",
    "Зберігай конкретну деталь лише тоді, коли без неї змінюється розуміння події, позиції або результату. Реакції, повтори, побутові відгалуження та ілюстративні дрібниці стискай або опускай.",
    "Не перераховуй claims і не використовуй технічну лексику на кшталт claim, evidence чи episode у відповіді.",
    "Не додавай інформації та зв'язків, яких немає у вхідних твердженнях. Не виводь причинність із самої послідовності реплік і не перетворюй припущення на підтверджений факт.",
    "Точно зберігай авторство, заперечення, невизначеність, порівняння та числові кваліфікатори: наприклад, «найвища оцінка» не означає «середня оцінка».",
    "Якщо авторство не випливає однозначно з тверджень, використовуй нейтральне формулювання на кшталт «у чаті згадали», а не приписуй слова конкретній людині.",
    "Останні суттєві події можна описати конкретніше, але не витісняй через це важливий попередній контекст. Не використовуй штучний ліміт речень.",
    "Поле summary почни словами «Коротко:». Поверни тільки JSON:",
    JSON.stringify(
      {
        title: "Коротка назва",
        summary: "Коротко: природний переказ розмови.",
      },
      null,
      2,
    ),
    "Епізоди:",
    JSON.stringify({ episodes }, null, 2),
  ].join("\n\n");
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("uk-UA");
}

function byEvidence(left: Claim, right: Claim): number {
  return Math.min(...left.evidence) - Math.min(...right.evidence);
}
