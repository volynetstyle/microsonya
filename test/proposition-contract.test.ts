import { describe, expect, it } from "vitest";
import {
  evaluatePropositions,
  hasPropositionContract,
} from "./propositionEvaluation.js";
import { extractionFixtures } from "./extractionFixtures.js";

describe("semantic proposition contracts", () => {
  it("covers all long-context fixtures and live production regressions", () => {
    expect(
      extractionFixtures.every(({ id }) => hasPropositionContract(id)),
    ).toBe(true);
    expect(hasPropositionContract("live-prod-version-vs-time")).toBe(true);
    expect(
      hasPropositionContract("conversational-ellipsis-and-author-boundary"),
    ).toBe(true);
  });

  it("distinguishes an 18:00 deadline from version 1.8", () => {
    const faithful = evaluatePropositions(
      "live-prod-version-vs-time",
      "Rollback зробили на 1.8.4. Якщо deploy до 18 не пройде, rollback на v2; якщо пройде, міграцію запускаємо завтра.",
    )!;
    const confused = evaluatePropositions(
      "live-prod-version-vs-time",
      "Rollback зробили на 1.8.4. Якщо deploy до 1.8 не пройде, rollback на v2; якщо пройде, міграцію запускаємо завтра.",
    )!;
    expect(faithful.score).toBe(1);
    expect(confused.violations.map(({ assertionId }) => assertionId)).toEqual(
      expect.arrayContaining(["live-deadline", "live-deadline-as-version"]),
    );
  });

  it("accepts locale decimals and does not treat a negated upgrade as a plan", () => {
    const localeDecimal = evaluatePropositions(
      "long-numeric-type-collision",
      "Продакшн працює на версії 1.8.4; оновлення до 2.0 поки не планується. Після rollback CPU склав 18%. Деплой моніторять до 18:00; якщо стан не зелений — rollback до v2. Error rate 1.8%. Canary зараз 10%; якщо error rate залишиться нижче 0,5% протягом 15 хв, його підвищать до 50%.",
    )!;

    expect(localeDecimal.score).toBe(1);
    expect(localeDecimal.violations).toEqual([]);
  });

  it("distinguishes other-project provenance from merely calling a quote irrelevant", () => {
    const faithful = evaluatePropositions(
      "long-quoted-message-provenance",
      "Наш deploy залишається на завтра. Скасування стосувалося іншого проєкту.",
    )!;
    const weakened = evaluatePropositions(
      "long-quoted-message-provenance",
      "Наш deploy залишається на завтра. Повідомлення про скасування неактуальне.",
    )!;
    expect(faithful.score).toBe(1);
    expect(weakened.errorsByType.PROVENANCE).toBe(1);
  });

  it("keeps hypotheses separate from the confirmed cause", () => {
    const faithful = evaluatePropositions(
      "long-hypothesis-vs-confirmed-cause",
      "Підтверджена причина: timeout не abort-ив HTTP request. Hotfix ще не викочено на prod.",
    )!;
    const invented = evaluatePropositions(
      "long-hypothesis-vs-confirmed-cause",
      "Причиною був Redis. Hotfix ще не викочено на prod.",
    )!;
    expect(faithful.score).toBe(1);
    expect(invented.errorsByType.EPISTEMIC_STATE).toBeGreaterThanOrEqual(1);
  });

  it("distinguishes the superseded value from the final state", () => {
    const faithful = evaluatePropositions(
      "long-frequency-vs-final-state",
      "Фінально: free tier 150 requests/min, paid tier 1000 requests/min.",
    )!;
    const stale = evaluatePropositions(
      "long-frequency-vs-final-state",
      "Фінально: free tier залишається 100 requests/min, paid tier 1000 requests/min.",
    )!;
    expect(faithful.score).toBe(1);
    expect(stale.errorsByType.SUPERSESSION).toBeGreaterThanOrEqual(1);
  });

  it("preserves author boundaries, ellipsis, speech acts, and reply referents", () => {
    const faithful = evaluatePropositions(
      "conversational-ellipsis-and-author-boundary",
      "Карінка купила хліб за 80 грн і лосьйон за 400 грн. Meleys схиляється до готового системного блока, а не замовної збірки; Oleksandr назвав цей вибір компромісом. Daria хотіла б, щоб їй дали гроші.",
    )!;
    const fluentButFalse = evaluatePropositions(
      "conversational-ellipsis-and-author-boundary",
      "Карінка купила хліб за 80 грн і лосьйон за 400 грн, а потім комп’ютер. Meleys планує купити блок живлення і готовий до замовлення збірки. Oleksandr запропонував компроміс. Daria хотіла б отримати допомогу.",
    )!;

    expect(faithful.score).toBe(1);
    expect(fluentButFalse.score).toBeLessThan(0.5);
    expect(fluentButFalse.errorsByType).toMatchObject({
      FACT_INVENTION: 1,
      PROVENANCE: 2,
      ENTITY_BINDING: 1,
      SPEECH_ACT: 1,
    });
  });
});
