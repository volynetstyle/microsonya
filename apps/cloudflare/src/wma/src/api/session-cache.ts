type CacheEnvelope<T> = Readonly<{ expiresAt: number; value: T }>;

export function telegramCacheScope(): string | undefined {
  const userId = window.Telegram?.WebApp?.initDataUnsafe.user?.id;
  if (userId !== undefined) return `user:${userId}`;
  return import.meta.env.DEV ? "development" : undefined;
}

export function readSessionCache<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return;
    const envelope = JSON.parse(raw) as Partial<CacheEnvelope<T>>;
    if (
      typeof envelope.expiresAt !== "number" ||
      envelope.expiresAt <= Date.now() ||
      envelope.value === undefined
    ) {
      sessionStorage.removeItem(key);
      return;
    }
    return envelope.value;
  } catch {
    return;
  }
}

export function writeSessionCache<T>(
  key: string,
  value: T,
  ttlMs: number,
): void {
  try {
    const envelope: CacheEnvelope<T> = {
      expiresAt: Date.now() + ttlMs,
      value,
    };
    sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Storage can be unavailable or full; network loading remains the fallback.
  }
}

export async function sessionCached<T>(
  resource: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const scope = telegramCacheScope();
  if (scope === undefined) return load();
  const key = `microsonya:wma:v1:${scope}:${resource}`;
  const cached = readSessionCache<T>(key);
  if (cached !== undefined) return cached;
  const value = await load();
  writeSessionCache(key, value, ttlMs);
  return value;
}

export function peekSessionCached<T>(resource: string): T | undefined {
  const scope = telegramCacheScope();
  return scope === undefined
    ? undefined
    : readSessionCache<T>(`microsonya:wma:v1:${scope}:${resource}`);
}
