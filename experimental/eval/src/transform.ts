import type { EvalMessage, Transformation } from "./types.js";

export function transformMessages(
  messages: EvalMessage[],
  transformation: Transformation,
): EvalMessage[] {
  switch (transformation) {
    case "identity":
    case "identity-replay":
      return structuredClone(messages);
    case "rename-users":
      return renameUsers(messages);
    case "shift-timestamps":
      return messages.map((message) => ({
        ...message,
        time: shiftTimestamp(message.time),
      }));
    case "interleave-threads":
      return interleaveThreads(messages);
  }
}

function interleaveThreads(messages: EvalMessage[]): EvalMessage[] {
  if (messages.some((message) => !message.fixtureThread)) {
    throw new Error(
      "interleave-threads requires fixtureThread on every canonical message",
    );
  }
  const timestamps = messages.map((message) => message.time);
  const groups = new Map<string, EvalMessage[]>();
  for (const message of messages) {
    const thread = message.fixtureThread!;
    groups.set(thread, [...(groups.get(thread) ?? []), message]);
  }
  const queues = [...groups.values()].map((group) => [...group]);
  const interleaved: EvalMessage[] = [];
  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const message = queue.shift();
      if (message) interleaved.push(message);
    }
  }
  return interleaved.map((message, index) => ({
    ...message,
    time: timestamps[index]!,
  }));
}

function renameUsers(messages: EvalMessage[]): EvalMessage[] {
  const aliases = new Map<string, string>();
  return messages.map((message) => {
    let alias = aliases.get(message.user);
    if (!alias) {
      alias = `U${aliases.size + 1}`;
      aliases.set(message.user, alias);
    }
    return { ...message, user: alias };
  });
}

function shiftTimestamp(value: string): string {
  const hhmm = /^(\d{2}):(\d{2})(.*)$/.exec(value);
  if (hhmm) {
    const total = Number(hhmm[1]) * 60 + Number(hhmm[2]) + 317;
    return `${pad(Math.floor((total % 1440) / 60))}:${pad(total % 60)}${hhmm[3]}`;
  }

  const date = new Date(value);
  if (!Number.isNaN(date.valueOf())) {
    return new Date(date.valueOf() + 317 * 60_000).toISOString();
  }
  throw new Error(`Cannot shift unsupported timestamp: ${value}`);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
