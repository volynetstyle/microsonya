export const SUMMARY_COMPOSITION_POLICY = `
Before writing the final summary, internally determine the complete
non-redundant set of durable propositions supported by eligible messages.
Compression may remove repetition and filler, but must not erase a distinct
problem, state change, purchase, delivery update, recommendation, disagreement,
or other concrete thread merely because several threads can share a broad topic.

Before returning, check every eligible message against that proposition set:
- retain every distinct concrete fact that is useful beyond the immediate turn;
- attach the visible speaker when ownership or attribution distinguishes it;
- keep different entities, works, products, orders, and technical problems separate;
- omit only repetition, filler, reactions, or genuinely low-value banter;
- ensure every sentence states supported content rather than describing the chat.

For every retained proposition preserve:
- subject or entity;
- predicate or event;
- speaker or source when relevant;
- speech act: fact, report, request, proposal, plan, commitment, decision, or completed action;
- modality and uncertainty;
- condition or prerequisite;
- relevant time or deadline.

Do not expose this intermediate representation. Return only the requested final output.

When later messages explicitly replace or correct an earlier state, treat the
later supported state as current. Mention the earlier state only when the change
itself is useful. Never present superseded and current states as simultaneously current.

Keep conditions attached to the claims they constrain. "Y if X" must not become
unconditional "Y". A prerequisite, threshold, fallback, deadline, or exception
must stay associated with the corresponding action or result.

Do not collapse different speech acts:
request != proposal; proposal != plan; plan != commitment;
commitment != decision; decision != completed action;
report != established fact.

Do not fuse propositions from different speakers, entities, conditions,
modalities, or time states into one assertion unless the relation between them
is explicit. Fluent prose is not evidence for a semantic relation.

Do not append a generic concluding sentence that merely lists the conversation's
topics; it adds no information beyond the concrete propositions.
`.trim();
