import type { TelegramWebApp } from "../api/types";

export const WMA_RELEASE = Object.freeze({
  version: "2026.09.07.1",
  title: "Що нового",
  message: [
    "Підсумки тепер краще зберігають імена учасників і конкретні факти.",
    "Внутрішні позначки авторів більше не потрапляють у готовий текст.",
    "Навігація між чатами та підсумками стала плавнішою.",
  ].map((item) => `• ${item}`).join("\n"),
});

const STORAGE_KEY = "microsonya.wma.release.seen";

export async function showLatestRelease(
  webApp: TelegramWebApp | undefined = window.Telegram?.WebApp,
  storage: Storage = window.localStorage,
): Promise<boolean> {
  if (await readSeenVersion(webApp, storage) === WMA_RELEASE.version) {
    return false;
  }

  if (webApp?.isVersionAtLeast("6.2")) {
    webApp.showPopup(
      {
        title: WMA_RELEASE.title,
        message: WMA_RELEASE.message,
        buttons: [{ id: "continue", type: "ok", text: "Зрозуміло" }],
      },
      () => persistSeenVersion(webApp, storage),
    );
    return true;
  }

  window.alert(`${WMA_RELEASE.title}\n\n${WMA_RELEASE.message}`);
  persistSeenVersion(webApp, storage);
  return true;
}

async function readSeenVersion(
  webApp: TelegramWebApp | undefined,
  storage: Storage,
): Promise<string | null> {
  const local = safeGet(storage, STORAGE_KEY);
  if (local === WMA_RELEASE.version || webApp === undefined) return local;

  const cloud = await new Promise<string | null>((resolve) => {
    webApp.CloudStorage.getItem(STORAGE_KEY, (error, value) => {
      resolve(error === null && value ? value : null);
    });
  });
  return cloud ?? local;
}

function persistSeenVersion(
  webApp: TelegramWebApp | undefined,
  storage: Storage,
): void {
  try {
    storage.setItem(STORAGE_KEY, WMA_RELEASE.version);
  } catch {
    // A denied localStorage write must not break the Mini App.
  }
  webApp?.CloudStorage.setItem(STORAGE_KEY, WMA_RELEASE.version);
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
