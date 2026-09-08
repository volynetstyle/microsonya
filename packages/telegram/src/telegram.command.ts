import type { TelegramMessage } from "./telegram.message.js";

export interface TelegramCommandInvocation {
  readonly name: string;
  readonly target?: string;
  readonly args: string;
  readonly message: TelegramMessage;
}
export function parseTelegramCommand(
  message: TelegramMessage,
  botUsername?: string,
): TelegramCommandInvocation | undefined {
  if (
    message.forwarded ||
    message.text === undefined ||
    message.commandEntity === undefined
  )
    return undefined;
  const { offset, length } = message.commandEntity;
  const token = parseCommandToken(message.text.slice(offset, offset + length));
  if (
    token === undefined ||
    (token.target !== undefined &&
      !matchesBotUsername(token.target, botUsername))
  )
    return undefined;
  return {
    name: token.name.toLowerCase(),
    ...(token.target === undefined ? {} : { target: token.target }),
    args: message.text.slice(offset + length).trim(),
    message,
  };
}
function parseCommandToken(
  raw: string,
): { readonly name: string; readonly target?: string } | undefined {
  const match = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?$/iu.exec(raw);
  if (!match?.[1]) return undefined;
  return {
    name: match[1],
    ...(match[2] === undefined ? {} : { target: match[2] }),
  };
}
function matchesBotUsername(target: string, botUsername?: string): boolean {
  return (
    botUsername !== undefined &&
    target.toLowerCase() === botUsername.replace(/^@/u, "").toLowerCase()
  );
}
