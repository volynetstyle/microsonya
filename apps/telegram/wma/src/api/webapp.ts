export type {
  TelegramPlatform,
  TelegramSafeAreaInset,
  TelegramThemeParams,
  TelegramWebApp,
} from "./types";
import type { TelegramWebApp } from "./types";

import { getTelegramChatTitle } from "./chat-context";
import { observeClientEnvironment } from "./environment";

/**
 * Connects Telegram host state and native chrome to the web UI.
 *
 * Theme, viewport and safe-area values are consumed through the official CSS
 * variables installed and updated by `telegram-web-app.js`. Mirroring those
 * values into inline styles would duplicate SDK state and create a second
 * synchronization path.
 *
 * The synchronous head script applies theme and platform before first paint;
 * see `prepaint.inline.js`. The complete deferred SDK owns runtime updates
 * and native APIs. Outside Telegram this only applies the browser profile.
 *
 * @see https://core.telegram.org/bots/webapps#initializing-mini-apps
 */
export function initTelegram(): () => void {
  const root = document.documentElement;
  let stopRuntime: (() => void) | undefined;

  // telegram-web-app.js also creates an API object in an ordinary browser.
  // The prepaint launch params, not object existence, identify the real host.
  if (root.dataset.host !== "telegram") {
    return observeClientEnvironment(root, undefined);
  }

  const connect = () => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp || stopRuntime) return;
    stopRuntime = connectTelegramRuntime(root, webApp);
  };

  connect();

  // A cached local module may execute before the deferred network SDK. The
  // defer script is guaranteed to finish before window.load, so retry there.
  if (!stopRuntime) window.addEventListener("load", connect, { once: true });

  return () => {
    window.removeEventListener("load", connect);
    stopRuntime?.();
  };
}

function connectTelegramRuntime(
  root: HTMLElement,
  webApp: TelegramWebApp,
): () => void {
  const stopEnvironment = observeClientEnvironment(root, webApp);
  const chatTitle = getTelegramChatTitle(webApp);

  if (chatTitle) document.title = chatTitle;

  // These host events do not participate in constructing the initial CSS
  // theme, so they can wait for the deferred official SDK.
  webApp.ready();
  webApp.expand();

  const syncHost = () => {
    root.dataset.tgColorScheme = webApp.colorScheme;
    root.style.colorScheme = webApp.colorScheme;

    const bg = webApp.themeParams.bg_color;
    const header =
      webApp.themeParams.header_bg_color ??
      webApp.themeParams.section_bg_color ??
      bg;
    const bottom = webApp.themeParams.bottom_bar_bg_color ?? bg;

    if (header) webApp.setHeaderColor(header);
    if (bg) webApp.setBackgroundColor(bg);
    if (bottom && webApp.isVersionAtLeast("7.10")) {
      webApp.setBottomBarColor(bottom);
    }
  };

  syncHost();
  webApp.onEvent("themeChanged", syncHost);

  // The long scrollable summary list conflicts with Telegram's own
  // swipe-to-close gesture on mobile clients.
  if (webApp.isVersionAtLeast("7.7")) {
    webApp.disableVerticalSwipes();
  }

  return () => {
    stopEnvironment();
    webApp.offEvent("themeChanged", syncHost);
  };
}
