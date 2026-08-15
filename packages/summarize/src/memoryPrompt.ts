import type { ChatMessage, MemoryItem, MemoryKind } from "@microsonya/shared";

export const MEMORY_PROMPT_VERSION = "memory-ops-v1";

export type NormalizedMemoryMessage = ChatMessage & {
  order: number;
  authorAlias: string;
};

const MEMORY_KINDS: MemoryKind[] = [
  "fact",
  "decision",
  "open_question",
  "plan",
  "result",
];

const MEMORY_OP_CONTRACT = `{
  "operations": [
    { "type": "create", "kind": "fact|decision|open_question|plan|result", "text": "...", "evidence": [501] },
    { "type": "support", "targetId": "mem_000001", "evidence": [502] },
    { "type": "update", "targetId": "mem_000001", "text": "...", "evidence": [503] },
    { "type": "resolve", "targetId": "mem_000001", "text": "...", "evidence": [504] },
    { "type": "supersede", "targetId": "mem_000001", "replacement": "...", "evidence": [505] },
    { "type": "retract", "targetId": "mem_000001", "evidence": [506] }
  ]
}`;

export function buildMemoryOpsPrompt(
  messages: readonly NormalizedMemoryMessage[],
  relevantMemory: readonly MemoryItem[],
): string {
  return [
    "You are a semantic change detector for persistent chat memory.",
    "The runtime owns identity, lifecycle, validation, and all state mutations.",
    "You may only propose operations. Treat memory and message IDs as opaque runtime IDs.",
    "Return an object with one field: operations. Return [] when the messages change nothing persistent.",
    "Use exactly the field names and operation shapes below. Do not rename, flatten, or invent fields.",
    "Do not return operation, action, decision, evidence_message_id, or any prose outside the JSON object.",
    "",
    "Exact output contract (the array may contain zero or more of these variants):",
    MEMORY_OP_CONTRACT,
    "",
    'No semantic change must be exactly: {"operations":[]}',
    'Create example: {"operations":[{"type":"create","kind":"decision","text":"Use PostgreSQL","evidence":[481]}]}',
    'Resolve example: {"operations":[{"type":"resolve","targetId":"mem_000058","text":"Redis will not be introduced","evidence":[503,504]}]}',
    "",
    "Rules:",
    "- Every operation must be directly supported by one or more NEW MESSAGE IDs in evidence.",
    "- Never invent a targetId or evidence ID.",
    "- Never generate an ID for create; the runtime assigns it.",
    "- Prefer support when a message only reinforces an existing item.",
    "- Use update only when wording changes but identity remains the same.",
    "- Use resolve for an existing open_question that receives an answer or decision.",
    "- Use supersede when a previously active claim, decision, or plan is replaced.",
    "- Use retract only when the source explicitly withdraws an item without replacing it.",
    `- create.kind must be one of: ${MEMORY_KINDS.join(", ")}.`,
    "- Preserve explicit reply topology. Do not infer structural reply links.",
    "- Ignore greetings, jokes, repetition, and editorial prose unless they change persistent state.",
    "",
    "Relevant materialized memory (trusted runtime state):",
    formatMemory(relevantMemory),
    "",
    "New normalized messages (the only allowed evidence):",
    formatMessages(messages),
  ].join("\n");
}

function formatMemory(items: readonly MemoryItem[]): string {
  if (items.length === 0) return "(none)";

  return items
    .map(
      (item) =>
        `[${item.id}] kind=${item.kind} status=${item.status} | ${item.text}`,
    )
    .join("\n");
}

function formatMessages(messages: readonly NormalizedMemoryMessage[]): string {
  if (messages.length === 0) return "(none)";

  return messages
    .map((message) => {
      const reply =
        message.replyToId === undefined ? "-" : String(message.replyToId);
      return `[${message.id}] order=${message.order} author=${message.authorAlias} replyTo=${reply} | ${message.text}`;
    })
    .join("\n");
}
