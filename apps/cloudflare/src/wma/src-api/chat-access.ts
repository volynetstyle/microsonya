type Fetch = typeof fetch;

export interface AccessibleTelegramChat {
  readonly title: string;
  readonly photoFileId?: string;
}

export interface AccessibleTelegramChat {
  readonly title: string;
  readonly photoFileId?: string;
}

/**
 * Checks only the security boundary.
 *
 * Any network, API, or response-shape failure denies access.
 */
export async function isTelegramChatAccessible(
  token: string,
  chatId: string,
  userId: string,
  fetcher: Fetch = fetch,
): Promise<boolean> {
  const body = await callTelegram(
    fetcher,
    `https://api.telegram.org/bot${token}/getChatMember`,
    {
      chat_id: chatId,
      user_id: userId,
    },
  );

  return isTelegramOk(body) && isCurrentTelegramMember(body.result, userId);
}

/**
 * Checks access and then resolves presentation metadata.
 */
export async function getAccessibleTelegramChat(
  token: string,
  chatId: string,
  userId: string,
  fetcher: Fetch = fetch,
): Promise<AccessibleTelegramChat | undefined> {
  if (!(await isTelegramChatAccessible(token, chatId, userId, fetcher))) {
    return;
  }

  const body = await callTelegram(
    fetcher,
    `https://api.telegram.org/bot${token}/getChat`,
    {
      chat_id: chatId,
    },
  );

  if (!isTelegramOk(body)) return;

  const result = asRecord(body.result);
  if (!result) return;

  const title =
    typeof result.title === "string"
      ? result.title
      : typeof result.first_name === "string"
        ? result.first_name
        : undefined;

  if (!title) return;

  const photo = asRecord(result.photo);

  return {
    title,
    ...(photo && typeof photo.big_file_id === "string"
      ? { photoFileId: photo.big_file_id }
      : {}),
  };
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
