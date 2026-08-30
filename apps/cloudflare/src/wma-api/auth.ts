export type TelegramIdentity = {
  user: { id: string; name: string };
  chat?: { id: string; title: string };
};
const MAX_AGE_SECONDS = 24 * 60 * 60;

/** Validates raw Telegram initData before any parsed field is trusted. */
export async function validateTelegramInitData(
  initData: string,
  botToken: string,
): Promise<TelegramIdentity> {
  if (!initData || !botToken)
    throw new TelegramInitDataError("Missing Telegram credentials.");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (
    !receivedHash ||
    !Number.isSafeInteger(authDate) ||
    Math.abs(Date.now() / 1000 - authDate) > MAX_AGE_SECONDS
  )
    throw new TelegramInitDataError("Expired or malformed Telegram initData.");
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = await hmacBytes("WebAppData", botToken);
  const expectedHash = await hmacHex(secret, dataCheckString);
  if (!constantTimeEqual(expectedHash, receivedHash))
    throw new TelegramInitDataError("Invalid Telegram initData signature.");
  const user = parseJson(params.get("user"), "user");
  const chat = params.has("chat")
    ? parseJson(params.get("chat"), "chat")
    : undefined;
  const chatTitle = chat?.title;
  if (typeof user.id !== "number" || typeof user.first_name !== "string")
    throw new TelegramInitDataError("Telegram user is missing.");
  if (chat && (typeof chat.id !== "number" || typeof chatTitle !== "string"))
    throw new TelegramInitDataError("Telegram chat is malformed.");
  return {
    user: {
      id: String(user.id),
      name: [user.first_name, user.last_name].filter(Boolean).join(" "),
    },
    ...(chat
      ? { chat: { id: String(chat.id), title: chatTitle as string } }
      : {}),
  };
}
export class TelegramInitDataError extends Error {}
function parseJson(
  value: string | null,
  field: string,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? "");
    if (parsed && typeof parsed === "object")
      return parsed as Record<string, unknown>;
  } catch {}
  throw new TelegramInitDataError(`Telegram ${field} is malformed.`);
}
async function hmacBytes(
  key: string | Uint8Array,
  value: string,
): Promise<Uint8Array> {
  const rawKey = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey.slice().buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(value),
    ),
  );
}
async function hmacHex(
  key: string | Uint8Array,
  value: string,
): Promise<string> {
  const signature = await hmacBytes(key, value);
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
