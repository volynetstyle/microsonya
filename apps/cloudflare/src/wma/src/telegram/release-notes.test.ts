import { describe, expect, it, vi } from "vitest";
import type { TelegramWebApp } from "../api/types";
import { showLatestRelease, WMA_RELEASE } from "./release-notes";

describe("WMA release notes", () => {
  it("shows a Telegram-native popup once per release", async () => {
    const values = new Map<string, string>();
    let closePopup: (() => void) | undefined;
    const showPopup = vi.fn((_params, callback) => {
      closePopup = () => callback?.("continue");
    });
    const webApp = {
      isVersionAtLeast: () => true,
      showPopup,
      CloudStorage: {
        getItem: (
          _key: string,
          callback: (error: null, value?: string) => void,
        ) => {
          callback(null, undefined);
        },
        setItem: vi.fn(),
      },
    } as unknown as TelegramWebApp;
    const storage = memoryStorage(values);

    await expect(showLatestRelease(webApp, storage)).resolves.toBe(true);
    expect(showPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        title: WMA_RELEASE.title,
        message: expect.stringContaining("імена учасників"),
      }),
      expect.any(Function),
    );

    closePopup?.();
    await expect(showLatestRelease(webApp, storage)).resolves.toBe(false);
    expect(showPopup).toHaveBeenCalledTimes(1);
  });

  it("shows the next release even when an older version was seen", async () => {
    const storage = memoryStorage(
      new Map([["microsonya.wma.release.seen", "2026.09.06"]]),
    );
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);

    await expect(showLatestRelease(undefined, storage)).resolves.toBe(true);
    expect(alert).toHaveBeenCalledOnce();
    await expect(showLatestRelease(undefined, storage)).resolves.toBe(false);
  });
});

function memoryStorage(values: Map<string, string>): Storage {
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}
