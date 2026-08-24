import { z } from "zod";

export const compactionActionSchema = z.enum([
  "SUMMARIZE",
  "DEFER_COMPACT",
  "DEFER_INCOMPLETE",
  "DEFER_CONTEXT",
  "SKIP_BANTER",
  "SKIP_REACTIONS",
  "SKIP_NO_VALUE",
]);
export type CompactionAction = z.infer<typeof compactionActionSchema>;

export const compactionFixtureSchema = z
  .array(
    z
      .object({
        id: z.string().min(1),
        expected: compactionActionSchema,
        messages: z
          .array(
            z
              .object({
                user: z.string().min(1),
                time: z.string().min(1),
                text: z.string().min(1),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
  )
  .min(1);
export type CompactionFixture = z.infer<typeof compactionFixtureSchema>;

export const compactionPromptVariantSchema = z.enum([
  "original",
  "identity-replay",
  "rules-only",
  "lexical-clones",
  "cross-domain",
  "cross-language",
]);
export type CompactionPromptVariant = z.infer<
  typeof compactionPromptVariantSchema
>;

const BOUNDARY_EXAMPLES: Record<CompactionPromptVariant, string[]> = {
  original: [
    'Messages: "Deploy moved to Thursday." / "Stripe production access is pending." => {"action":"DEFER_COMPACT"}',
    'Messages: "He agreed." / "Not to option two, to the one discussed yesterday." => {"action":"DEFER_CONTEXT"}',
    'Messages: "ахахах" / "😭😭" / "жесть" / "💀" => {"action":"SKIP_REACTIONS"}',
    'Messages: "We need to change something." / "Maybe; it is not very good now." => {"action":"SKIP_NO_VALUE"}',
    'Messages: "I found the memory leak." / "It seems subscriptions are not disposed." / "I am checking with a heap snapshot." => {"action":"DEFER_INCOMPLETE"}',
    'Messages: "He agreed." / "Not option two; the one discussed yesterday." / "It must be ready Friday." => {"action":"DEFER_CONTEXT"}',
    'Messages: "Renderer invariants: framework does not own state; core imports no UI framework or DOM; UI uses an adapter; renderer is replaceable." => {"action":"DEFER_COMPACT"}',
    'Messages: "Він погодився." / "Не на другий варіант, а на той, що обговорювали вчора." / "До п’ятниці має бути готово." => {"action":"DEFER_CONTEXT"}',
    'Messages: "Треба змінити схему кешування API: весь response ламає персоналізовані поля." / "Є два варіанти. Зараз напишу." => {"action":"DEFER_INCOMPLETE"}',
    'Messages: "API cache stores the whole response and breaks personalized fields." / "There are two alternatives; I will write them next." => {"action":"DEFER_INCOMPLETE"}',
    'Messages: "Deploy перенесли на четвер через Stripe." / "Checkout лишається за feature flag; решту релізу катимо незалежно." / "Migration запускаємо в середу ввечері; у четвер checkout після Stripe." => {"action":"SUMMARIZE"}',
    'Messages: "Consumers require schemaVersion; unknown versions go to quarantine." / "Legacy events temporarily receive v1 at the gateway and are replayed." / "Remove the fallback after old lag is zero and quarantine stays empty." => {"action":"SUMMARIZE"}',
  ],
  "identity-replay": [],
  "rules-only": [],
  "lexical-clones": [
    'Messages: "The archive review moved to Monday." / "The curator approval is still pending." => {"action":"DEFER_COMPACT"}',
    'Messages: "They accepted it." / "The arrangement mentioned earlier, not the alternate one." => {"action":"DEFER_CONTEXT"}',
    'Messages: "wow" / "👏" / "indeed" => {"action":"SKIP_REACTIONS"}',
    'Messages: "Something about this feels off." / "We should revisit it sometime." => {"action":"SKIP_NO_VALUE"}',
    'Messages: "The contamination may come from the second reagent." / "The control sample is still incubating." => {"action":"DEFER_INCOMPLETE"}',
    'Messages: "The exhibit labels are immutable; storage owns no catalog state; access uses a registry adapter." => {"action":"DEFER_COMPACT"}',
    'Messages: "The shipment clears customs Friday." / "Inspection is Monday, unloading follows clearance, and damaged seals trigger return." => {"action":"SUMMARIZE"}',
  ],
  "cross-domain": [
    'Messages: "The hearing moved to Tuesday." / "The expert report is still pending." => {"action":"DEFER_COMPACT"}',
    'Messages: "The northern parcel accepted it after their step." / "The southern parcel remains under the old easement." => {"action":"DEFER_CONTEXT"}',
    'Messages: "haha" / "that is wild" / "😅" => {"action":"SKIP_REACTIONS"}',
    'Messages: "The lesson should somehow be different." / "Perhaps; we will think about it." => {"action":"SKIP_NO_VALUE"}',
    'Messages: "The alloy fracture may begin at the weld." / "Microscopy results arrive tomorrow." => {"action":"DEFER_INCOMPLETE"}',
    'Messages: "The carrier remains sealed; custody changes require signatures; damaged seals quarantine the parcel." => {"action":"DEFER_COMPACT"}',
    'Messages: "The line changes alloy Monday, calibrates Tuesday, runs 10% Wednesday, and reverts if defects exceed 0.2%." => {"action":"SUMMARIZE"}',
  ],
  "cross-language": [
    'Messages: "La audiencia se aplazó hasta el martes." / "Aún falta el informe pericial." => {"action":"DEFER_COMPACT"}',
    'Messages: "Aceptaron aquello." / "No la segunda opción, sino la que discutimos ayer." => {"action":"DEFER_CONTEXT"}',
    'Messages: "jajaja" / "qué fuerte" / "😮" => {"action":"SKIP_REACTIONS"}',
    'Messages: "Algo debería cambiar." / "Quizá; ya lo pensaremos." => {"action":"SKIP_NO_VALUE"}',
    'Messages: "La grieta podría venir de la soldadura." / "La microscopía todavía no ha terminado." => {"action":"DEFER_INCOMPLETE"}',
    'Messages: "El contenedor permanece sellado; cada cambio de custodia requiere firma." => {"action":"DEFER_COMPACT"}',
    'Messages: "Primero inspeccionamos, después liberamos el lote y volvemos al proceso anterior si los defectos superan el límite." => {"action":"SUMMARIZE"}',
  ],
};

export function buildCompactionPrompt(
  fixture: CompactionFixture[number],
  promptVariant: CompactionPromptVariant = "original",
): string {
  const examples =
    promptVariant === "identity-replay"
      ? BOUNDARY_EXAMPLES.original
      : BOUNDARY_EXAMPLES[promptVariant];
  return [
    "Choose whether this chat window should now be summarized into durable history.",
    'Return JSON only: {"action":"ONE_LABEL"}.',
    "Apply these rules in order. Stop at the first matching rule.",
    "1. IF every message is only a greeting, acknowledgement, emotional reaction, laughter, emoji, or short response to another message, AND no message expresses even a vague problem, proposal, assessment, or topic: RETURN SKIP_REACTIONS",
    "2. IF the window is primarily jokes, wordplay, playful exaggeration, or social banter, and contains no durable information worth preserving: RETURN SKIP_BANTER",
    "3. IF the window contains only vague discussion, concern, assessment, or a proposal without a concrete durable object, decision, plan, argument, or result: RETURN SKIP_NO_VALUE. A named component, system behaviour, technical defect, or concrete problem is a concrete durable object even before a decision is made. Likewise, a concrete agreement, dependency, exception, or deadline expressed with unresolved aliases or pronouns is not no-value; continue to the context rule instead.",
    "4. IF any referent essential to preserving the durable information is unresolved in this window, RETURN DEFER_CONTEXT even if there is a deadline, apparent agreement, or otherwise compact-looking update. An unresolved joke, optional name, or other banter is not essential when an independent durable decision is fully specified. Do not guess who, what object, what proposal, what task, or what deliverable is meant.",
    "5. IF the visible exchange contains an unverified hypothesis, uncertainty, or explicitly shows that a result, answer, verification, explanation, decision, or set of alternatives is still pending: RETURN DEFER_INCOMPLETE",
    "6. IF all durable information is already stated as one self-contained decision, status update, result, short plan, or compact list of invariants, AND a future reader would gain no materially shorter or clearer model from cross-message synthesis: RETURN DEFER_COMPACT. Here, a short plan means one action, or one action with a deadline; it does not include a staged schedule with gates, thresholds, prerequisites, fallback, or rollback. A steady-state architecture contract plus a temporary compatibility path and criteria for removing that path are two semantic phases, not one compact item. Message length and the number of facts do not by themselves justify summarization.",
    "7. RETURN SUMMARIZE when durable information must be combined across messages into a materially clearer model. Strong signals are multiple dependent steps, sequencing, prerequisites, thresholds, fallback or rollback conditions, parallel work streams, or an architecture contract plus a separate migration, compatibility, or retirement lifecycle. A plan is not 'one short plan' merely because its steps can be listed in one sentence.",
    ...(examples.length > 0 ? ["Boundary examples:", ...examples] : []),
    "Do not infer missing context or turn hypotheses, jokes, or reactions into facts.",
    "Messages:",
    ...fixture.messages.map(
      (message) => `[${message.time}] ${message.user}: ${message.text}`,
    ),
  ].join("\n");
}

export function parseCompactionAction(raw: string): CompactionAction | null {
  try {
    return compactionActionSchema.parse(JSON.parse(raw).action);
  } catch {
    return null;
  }
}
