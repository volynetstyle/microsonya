import { observeClientEnvironment } from "../api/environment";
import type { TelegramWebApp } from "../api/types";

export function initTelegramRuntime(): () => void {
  const root = document.documentElement;
  const webApp = window.Telegram?.WebApp;
  const stopEnvironment = observeClientEnvironment(root, webApp);
  if (!webApp) return stopEnvironment;
  const sync = () => applyChrome(root, webApp);
  sync();
  webApp.onEvent("themeChanged", sync);
  if (webApp.isVersionAtLeast("7.7")) webApp.disableVerticalSwipes();
  return () => {
    stopEnvironment();
    webApp.offEvent("themeChanged", sync);
  };
}

function applyChrome(root: HTMLElement, webApp: TelegramWebApp): void {
  root.dataset.tgColorScheme = webApp.colorScheme;
  root.style.colorScheme = webApp.colorScheme;
  const background = webApp.themeParams.bg_color;
  const header =
    webApp.themeParams.header_bg_color ??
    webApp.themeParams.section_bg_color ??
    background;
  const bottom = webApp.themeParams.bottom_bar_bg_color ?? background;
  if (header) webApp.setHeaderColor(header);
  if (background) webApp.setBackgroundColor(background);
  if (bottom && webApp.isVersionAtLeast("7.10"))
    webApp.setBottomBarColor(bottom);
}
