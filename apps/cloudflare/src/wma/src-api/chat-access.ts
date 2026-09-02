type Fetch = typeof fetch;

/**
 * Resolves a chat title only when Telegram confirms that the requesting user is
 * currently a member. Any network, API, or response-shape failure denies
 * access.
 */
export async function getAccessibleTelegramChatTitle(
  token: string,
  chatId: string,
  userId: string,
  fetcher: Fetch = fetch,
): Promise<string | undefined> {
  const apiBase = `https://api.telegram.org/bot${token}`;
  const memberBody = await callTelegram(fetcher, `${apiBase}/getChatMember`, {
    chat_id: chatId,
    user_id: userId,
  });
  if (!isTelegramOk(memberBody)) return;
  if (!isCurrentTelegramMember(memberBody.result, userId)) return;

  const chatBody = await callTelegram(fetcher, `${apiBase}/getChat`, {
    chat_id: chatId,
  });
  if (!isTelegramOk(chatBody)) return;
  const result = asRecord(chatBody.result);
  if (!result) return;
  if (typeof result.title === "string") return result.title;
  return typeof result.first_name === "string" ? result.first_name : undefined;
}

/** Telegram uses successful ChatMember responses for both members and leavers. */
export function isCurrentTelegramMember(
  value: unknown,
  expectedUserId: string,
): boolean {
  const member = asRecord(value);
  const user = asRecord(member?.user);
  if (!member || !user || String(user.id) !== expectedUserId) return false;

  if (
    member.status === "creator" ||
    member.status === "administrator" ||
    member.status === "member"
  ) {
    return true;
  }
  return member.status === "restricted" && member.is_member === true;
}

async function callTelegram(
  fetcher: Fetch,
  url: string,
  body: Readonly<Record<string, string>>,
): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    return await response.json();
  } catch {
    return;
  }
}

function isTelegramOk(
  value: unknown,
): value is { readonly ok: true; readonly result: unknown } {
  const record = asRecord(value);
  return record?.ok === true && "result" in record;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
