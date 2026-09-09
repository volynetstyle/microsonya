export class WmaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function postJson<T>(path: string, initData: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "X-Telegram-Init-Data": initData,
      "X-Time-Zone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
  if (!response.ok)
    throw new WmaApiError(response.status, await response.text());
  return response.json() as Promise<T>;
}
