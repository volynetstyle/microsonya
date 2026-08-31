export type SemanticErrorType =
  | "FACT_OMISSION"
  | "FACT_INVENTION"
  | "ENTITY_BINDING"
  | "NUMERIC_TYPE"
  | "PROVENANCE"
  | "SUPERSESSION"
  | "EPISTEMIC_STATE"
  | "SPEECH_ACT"
  | "CONDITION_PRESERVATION";

export interface PropositionAssertion {
  readonly id: string;
  readonly errorType: SemanticErrorType;
  readonly description: string;
  readonly test: (summary: string) => boolean;
}

export interface PropositionViolation {
  readonly assertionId: string;
  readonly errorType: SemanticErrorType;
  readonly description: string;
}

export interface PropositionMetrics {
  readonly passed: number;
  readonly total: number;
  readonly score: number;
  readonly violations: readonly PropositionViolation[];
  readonly errorsByType: Readonly<Partial<Record<SemanticErrorType, number>>>;
}

const definitions: Readonly<Record<string, readonly PropositionAssertion[]>> = {
  "long-buried-final-decision": [
    required("redis-selected", "FACT_OMISSION", "Redis remains selected", [
      /redis/iu,
      /залиш|обрал|selected|remain/iu,
    ]),
    required(
      "public-ttl",
      "ENTITY_BINDING",
      "Public profile fields have a ten-minute TTL",
      [/public|публічн/iu, /profile|профіл/iu, /10\s*(хв|min)/iu],
    ),
    required(
      "personalized-not-cached",
      "ENTITY_BINDING",
      "Personalized fields are not cached",
      [/personal|персонал/iu, /не\s+кеш|not\s+cache/iu],
    ),
    required(
      "invalidation-on-update",
      "CONDITION_PRESERVATION",
      "Profile update invalidates cache",
      [/інвалід|invalidat/iu, /оновлен|update/iu, /profile|профіл/iu],
    ),
  ],
  "long-multiple-corrections": [
    required(
      "release-thursday",
      "SUPERSESSION",
      "Thursday is the final release day",
      [/реліз|release/iu, /четвер|thursday/iu],
    ),
    required(
      "checkout-conditional",
      "CONDITION_PRESERVATION",
      "Checkout activation depends on green smoke tests",
      [
        /checkout/iu,
        /smoke/iu,
        /якщо|if|за умови/iu,
        /зелен|успіш|пройд|green|pass/iu,
      ],
    ),
    forbidden(
      "friday-final",
      "SUPERSESSION",
      "Friday must not be stated as the unconditional final release day",
      /(?:реліз|release)[^.\n]*(?:фіналь|остаточ|запланован)[^.\n]*(?:п['’]?ятниц|friday)/iu,
    ),
  ],
  "long-hypothesis-vs-confirmed-cause": [
    required(
      "confirmed-timeout-cause",
      "EPISTEMIC_STATE",
      "The confirmed cause is a timeout that did not abort the HTTP request",
      [
        /timeout|таймаут/iu,
        /не\s+(?:abort|аборт|перерив|заверш)|did\s+not\s+abort/iu,
        /http|request|запит/iu,
        /причин|cause|підтверд|вияв|призвод/iu,
      ],
    ),
    required(
      "not-production",
      "EPISTEMIC_STATE",
      "The hotfix has not reached production",
      [
        /hotfix|виправлен/iu,
        /prod|production|продакшн|прод(?:\s|[.,]|$)/iu,
        /ще\s+(?:не|ні)|not\s+yet|не\s+(?:оновлен|випущ|викоч)/iu,
      ],
    ),
    forbidden(
      "hypothesis-promoted",
      "EPISTEMIC_STATE",
      "Redis, race condition, or connection pool must not be promoted to confirmed cause",
      /(?:причиною\s+(?:був|була)|confirmed cause(?:\s+was)?)[^.\n]*(?:redis|race condition|connection pool)|(?:redis|race condition|connection pool)[^.\n]*(?:був[а]?\s+причин|was\s+the\s+cause)/iu,
    ),
  ],
  "long-numeric-type-collision": [
    required(
      "current-version",
      "NUMERIC_TYPE",
      "Production current version is 1.8.4",
      [/prod|production|продакшн/iu, /1[.]8[.]4/iu],
    ),
    required(
      "deadline-18",
      "NUMERIC_TYPE",
      "18 is a time/deadline, not version 1.8",
      [/deploy|деплой/iu, /(?:до|by)\s*18(?![.\d])|18[:.]?00/iu],
    ),
    required("rollback-v2", "ENTITY_BINDING", "v2 is the rollback target", [
      /rollback|відкоч/iu,
      /v2/iu,
    ]),
    required(
      "canary-condition",
      "CONDITION_PRESERVATION",
      "Canary expands to 50% only after error rate below 0.5% for 15 minutes",
      [
        /canary/iu,
        /50\s*%/iu,
        /0[.]5\s*%/iu,
        /15\s*(хв|min)/iu,
        /якщо|if|за умови/iu,
      ],
    ),
    forbidden(
      "deadline-as-version",
      "NUMERIC_TYPE",
      "Deadline 18 must not become version 1.8",
      /deploy[^.\n]*(?:версі|version|до)\s*1[.]8(?![.]4)/iu,
    ),
    forbidden(
      "version-2-planned",
      "FACT_INVENTION",
      "Version 2.0 must not be presented as the planned deployment",
      /(?:deploy|деплой|розгор)[^.\n]*(?:версі|version)?\s*2[.]0|2[.]0[^.\n]*(?:буде\s+(?:deploy|деплой|розгор)|планується|planned)/iu,
    ),
  ],
  "long-quoted-message-provenance": [
    required(
      "our-plan",
      "FACT_OMISSION",
      "Our deployment remains planned for tomorrow",
      [
        /наш|our|prod|production|продакшн/iu,
        /міграц|migration|deploy|деплой/iu,
        /завтра|наступн(?:ого|ий)\s+д(?:ня|ень)|tomorrow|next\s+day/iu,
      ],
    ),
    required(
      "other-project",
      "PROVENANCE",
      "The quoted cancellation belongs to another project/service",
      [
        /скас|cancel/iu,
        /інш(?:ого|ий|ому)\s+(?:проєкт|проект|сервіс)|another\s+(?:project|service)|не\s+стосу(?:ється|валося)[^.\n]*(?:їхнього|нашого)\s+(?:проєкт|проект|сервіс)/iu,
      ],
    ),
    forbidden(
      "our-cancelled",
      "PROVENANCE",
      "The cancellation must not be attributed to our deployment",
      /наш[^.\n]*(?:deploy|деплой)[^.\n]*(?:скас|cancel)|(?:скас|cancel)[^.\n]*наш[^.\n]*(?:deploy|деплой)/iu,
    ),
  ],
  "long-frequency-vs-final-state": [
    required(
      "free-final",
      "SUPERSESSION",
      "Final free-tier limit is 150 requests per minute",
      [
        /free|безкоштов/iu,
        /150/iu,
        /(?:request|запит).{0,12}(?:min|хв)|(?:min|хв).{0,12}(?:request|запит)/iu,
      ],
    ),
    required(
      "paid-final",
      "ENTITY_BINDING",
      "Paid-tier limit is 1000 requests per minute",
      [
        /paid|платн/iu,
        /1000/iu,
        /(?:request|запит).{0,12}(?:min|хв)|(?:min|хв).{0,12}(?:request|запит)/iu,
      ],
    ),
    forbidden(
      "free-old-final",
      "SUPERSESSION",
      "The old free-tier value 100 must not be stated as final/current",
      /(?:free|безкоштов)[^.\n]*(?:остаточ|фіналь|поточн|залиш)[^.\n]*\b100\b|(?:остаточ|фіналь|поточн)[^.\n]*(?:free|безкоштов)[^.\n]*\b100\b/iu,
    ),
  ],
  "long-two-similar-services": [
    required("auth-redis", "ENTITY_BINDING", "Auth service retains Redis", [
      /auth/iu,
      /redis/iu,
      /залиш|remain|retain/iu,
    ]),
    required(
      "profile-local-public",
      "ENTITY_BINDING",
      "Profile public metadata uses local cache for five minutes",
      [/profile/iu, /public|публічн/iu, /local|локальн/iu, /5\s*(хв|min)/iu],
    ),
    required(
      "private-not-cached",
      "ENTITY_BINDING",
      "Private profile fields are not cached",
      [/private|приватн/iu, /не\s+кеш|not\s+cache/iu],
    ),
    forbidden(
      "auth-local",
      "ENTITY_BINDING",
      "Auth must not be bound to local cache",
      /auth(?:(?!profile|профіл)[^.\n])*(?:local|локальн)/iu,
    ),
  ],
  "live-prod-version-vs-time": [
    required(
      "live-current-version",
      "NUMERIC_TYPE",
      "Rollback/current production version is 1.8.4",
      [/rollback|відкоч/iu, /1[.]8[.]4/iu],
    ),
    required(
      "live-deadline",
      "NUMERIC_TYPE",
      "Deploy deadline is 18, not version 1.8",
      [/deploy|деплой/iu, /(?:до|by)\s*18(?![.\d])|18[:.]?00/iu],
    ),
    required(
      "live-conditional-plan",
      "CONDITION_PRESERVATION",
      "Failure rolls back to v2; success schedules migration tomorrow",
      [
        /якщо|if/iu,
        /rollback|відкоч/iu,
        /v2/iu,
        /міграц|migration/iu,
        /завтра|tomorrow/iu,
      ],
    ),
    forbidden(
      "live-deadline-as-version",
      "NUMERIC_TYPE",
      "Deploy deadline must not be rendered as 1.8",
      /deploy[^.\n]*(?:до|by|version|версі)\s*1[.]8(?![.]4)/iu,
    ),
    forbidden(
      "live-race-confirmed",
      "EPISTEMIC_STATE",
      "Race condition remains a hypothesis",
      /(?:race condition)[^.\n]*(?:підтверд|confirmed|була?\s+причин)|(?:причиною\s+(?:був|була)|confirmed cause)[^.\n]*race condition/iu,
    ),
  ],
  "conversational-ellipsis-and-author-boundary": [
    required(
      "karinka-purchases",
      "PROVENANCE",
      "Bread and lotion purchases belong to Карінка",
      [/карінк/iu, /хліб/iu, /лосьйон/iu, /80/iu, /400/iu],
    ),
    required(
      "meleys-ready-made-computer",
      "ENTITY_BINDING",
      "Meleys chooses a ready-made computer/system unit rather than a custom build",
      [
        /meleys/iu,
        /готов(?:ий|ого)|системн(?:ий|ого)\s+блок|готов(?:ий|ого)\s+(?:комп|пк)/iu,
        /збірк|сборк|custom\s+build/iu,
      ],
    ),
    required(
      "oleksandr-compromise-assessment",
      "SPEECH_ACT",
      "Oleksandr calls the resulting choice a compromise",
      [/oleksandr|олександр/iu, /компроміс|компромисс|compromise/iu],
    ),
    required(
      "daria-money-referent",
      "PROVENANCE",
      "Daria's reply refers specifically to receiving money",
      [/daria|дар[’'ь]?я/iu, /грош|ден(?:ьги|ег)|money/iu],
    ),
    forbidden(
      "psu-invented",
      "FACT_INVENTION",
      "The ambiguous word блок must not become a power supply",
      /блок\s+(?:живлення|питания)|power\s+supply|\bpsu\b/iu,
    ),
    forbidden(
      "karinka-computer-merge",
      "PROVENANCE",
      "Карінка's purchases must not be merged with the computer purchase",
      /карінк[^.\n]*(?:комп(?:’ютер|ьютер)?|пк|системн(?:ий|ого)\s+блок)|(?:комп(?:’ютер|ьютер)?|пк|системн(?:ий|ого)\s+блок)[^.\n]*карінк/iu,
    ),
    forbidden(
      "personal-readiness",
      "ENTITY_BINDING",
      "готовий must not be interpreted as personal readiness to order",
      /(?:готов(?:ий|а|і)|готовност)[^.\n]*(?:замов|заказ)|(?:замов|заказ)[^.\n]*(?:готов(?:ий|а|і)|готовност)/iu,
    ),
    forbidden(
      "compromise-proposed",
      "SPEECH_ACT",
      "Oleksandr's assessment must not become a proposed action",
      /oleksandr[^.\n]*(?:запропон|предлож|propos)[^.\n]*компроміс|олександр[^.\n]*(?:запропон|предлож)[^.\n]*компромисс/iu,
    ),
  ],
};

export function hasPropositionContract(fixtureId: string): boolean {
  return definitions[baseId(fixtureId)] !== undefined;
}

export function evaluatePropositions(
  fixtureId: string,
  summary: string | undefined,
): PropositionMetrics | undefined {
  const assertions = definitions[baseId(fixtureId)];
  if (!assertions) return undefined;
  const text = normalize(summary ?? "");
  const violations = assertions
    .filter((assertion) => !assertion.test(text))
    .map(({ id, errorType, description }) => ({
      assertionId: id,
      errorType,
      description,
    }));
  const errorsByType: Partial<Record<SemanticErrorType, number>> = {};
  for (const { errorType } of violations) {
    errorsByType[errorType] = (errorsByType[errorType] ?? 0) + 1;
  }
  return Object.freeze({
    passed: assertions.length - violations.length,
    total: assertions.length,
    score:
      assertions.length === 0
        ? 1
        : (assertions.length - violations.length) / assertions.length,
    violations: Object.freeze(violations),
    errorsByType: Object.freeze(errorsByType),
  });
}

function required(
  id: string,
  errorType: SemanticErrorType,
  description: string,
  clauses: readonly RegExp[],
): PropositionAssertion {
  return {
    id,
    errorType,
    description,
    test: (text) => clauses.every((clause) => clause.test(text)),
  };
}

function forbidden(
  id: string,
  errorType: SemanticErrorType,
  description: string,
  pattern: RegExp,
): PropositionAssertion {
  return { id, errorType, description, test: (text) => !pattern.test(text) };
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function baseId(fixtureId: string): string {
  return fixtureId.split("@")[0]!;
}
