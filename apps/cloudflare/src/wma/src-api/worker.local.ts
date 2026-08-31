import worker, { type WmaDevBindings } from "./worker.js";

type LocalEnv = Env &
  WmaDevBindings &
  Readonly<{
    WMA_DEV_USER_ID: string;
    WMA_DEV_USER_NAME: string;
    WMA_DEV_CHAT_ID: string;
    WMA_DEV_CHAT_TITLE: string;
  }>;

export default {
  async fetch(request, env): Promise<Response> {
    const headers = new Headers(request.headers);

    if (
      env.WMA_DEV_BYPASS_AUTH !== "true" &&
      !headers.get("X-Telegram-Init-Data")
    ) {
      headers.set("X-Telegram-Init-Data", await createDevInitData(env));
    }

    return worker.fetch(
      new Request(request, {
        headers,
      }) as Request,
      env,
    );
  },
} satisfies ExportedHandler<LocalEnv>;

async function createDevInitData(env: LocalEnv): Promise<string> {
  const params = new URLSearchParams();

  params.set(
    "user",
    JSON.stringify({
      id: Number(env.WMA_DEV_USER_ID),
      first_name: env.WMA_DEV_USER_NAME,
    }),
  );

  params.set(
    "chat",
    JSON.stringify({
      id: Number(env.WMA_DEV_CHAT_ID),
      title: env.WMA_DEV_CHAT_TITLE,
      type: "supergroup",
    }),
  );

  params.set("auth_date", Math.floor(Date.now() / 1000).toString());

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = await hmac(
    new TextEncoder().encode("WebAppData"),
    env.TELEGRAM_BOT_TOKEN,
  );

  const hash = await hmacHex(secret, dataCheckString);

  params.set("hash", hash);

  return params.toString();
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key).buffer,
    {
      name: "HMAC",
      hash: "SHA-256",
    },
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

async function hmacHex(key: Uint8Array, value: string): Promise<string> {
  const bytes = await hmac(key, value);

  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
